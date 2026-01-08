/**
 * SDK - Client SDK for an API
 *
 * Represents a generated client SDK with code generation, versioning.
 * Examples: JavaScript SDK, Python SDK, Go SDK
 */

import { Package, PackageConfig, PackageVersion } from './Package'
import { Env } from './DO'

export interface SDKConfig extends PackageConfig {
  apiId: string
  language: 'javascript' | 'typescript' | 'python' | 'go' | 'rust'
  generator?: string
  customizations?: Record<string, unknown>
}

export interface GeneratedFile {
  path: string
  content: string
  language: string
}

export class SDK extends Package {
  private sdkConfig: SDKConfig | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  /**
   * Get SDK configuration
   */
  async getSDKConfig(): Promise<SDKConfig | null> {
    if (!this.sdkConfig) {
      this.sdkConfig = (await this.ctx.storage.get('sdk_config')) as SDKConfig | null
    }
    return this.sdkConfig
  }

  /**
   * Configure the SDK
   */
  async configureSDK(config: SDKConfig): Promise<void> {
    this.sdkConfig = config
    await this.ctx.storage.put('sdk_config', config)
    await this.configure(config)
    await this.emit('sdk.configured', { config })
  }

  /**
   * Generate SDK code (stub - integrate with actual generators)
   */
  async generate(): Promise<GeneratedFile[]> {
    const config = await this.getSDKConfig()
    if (!config) throw new Error('SDK not configured')

    await this.emit('sdk.generating', { language: config.language })

    // In production, fetch OpenAPI spec from API and generate code
    // For now, return stub files
    const files: GeneratedFile[] = []

    switch (config.language) {
      case 'typescript':
      case 'javascript':
        files.push({
          path: 'src/index.ts',
          content: `// Generated SDK for ${config.name}\nexport class Client {\n  constructor(private apiKey: string) {}\n}`,
          language: 'typescript',
        })
        files.push({
          path: 'package.json',
          content: JSON.stringify(
            {
              name: config.name,
              version: '0.0.1',
              main: 'dist/index.js',
              types: 'dist/index.d.ts',
            },
            null,
            2,
          ),
          language: 'json',
        })
        break

      case 'python':
        files.push({
          path: 'src/__init__.py',
          content: `# Generated SDK for ${config.name}\nclass Client:\n    def __init__(self, api_key: str):\n        self.api_key = api_key`,
          language: 'python',
        })
        files.push({
          path: 'setup.py',
          content: `from setuptools import setup\nsetup(name='${config.name}', version='0.0.1')`,
          language: 'python',
        })
        break

      case 'go':
        files.push({
          path: 'client.go',
          content: `// Generated SDK for ${config.name}\npackage sdk\n\ntype Client struct {\n\tAPIKey string\n}`,
          language: 'go',
        })
        break

      case 'rust':
        files.push({
          path: 'src/lib.rs',
          content: `// Generated SDK for ${config.name}\npub struct Client {\n    api_key: String,\n}`,
          language: 'rust',
        })
        break
    }

    await this.emit('sdk.generated', { fileCount: files.length })
    return files
  }

  /**
   * Build and publish SDK
   */
  async buildAndPublish(version: string, publishedBy: string): Promise<PackageVersion> {
    const files = await this.generate()

    // Combine files into a single source bundle
    const source = files.map((f) => `// ${f.path}\n${f.content}`).join('\n\n')
    const hash = await this.hashContent(source)

    return this.publish({
      version,
      source,
      hash,
      size: source.length,
      publishedBy,
    })
  }

  /**
   * Hash content for integrity
   */
  private async hashContent(content: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(content)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/sdk/config') {
      if (request.method === 'GET') {
        const config = await this.getSDKConfig()
        return new Response(JSON.stringify(config), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (request.method === 'PUT') {
        const config = (await request.json()) as SDKConfig
        await this.configureSDK(config)
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    if (url.pathname === '/sdk/generate' && request.method === 'POST') {
      const files = await this.generate()
      return new Response(JSON.stringify(files), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/sdk/publish' && request.method === 'POST') {
      const { version, publishedBy } = (await request.json()) as { version: string; publishedBy: string }
      const published = await this.buildAndPublish(version, publishedBy)
      return new Response(JSON.stringify(published), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return super.fetch(request)
  }
}

export default SDK

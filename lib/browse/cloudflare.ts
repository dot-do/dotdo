/**
 * Cloudflare Browser Rendering Provider
 *
 * Implements the BrowseProvider interface using @cloudflare/puppeteer
 * for Cloudflare Workers Browser Rendering.
 */

import type {
  BrowseProvider,
  BrowseSession,
  BrowseInitConfig,
  ActResult,
  ObserveResult,
  ScreenshotOptions,
} from './index'

/**
 * Cloudflare Browser Rendering provider implementation
 */
export class CloudflareBrowseProvider implements BrowseProvider {
  async init(config: BrowseInitConfig): Promise<BrowseSession> {
    // Validate BROWSER binding
    if (!config.env?.BROWSER) {
      throw new Error('Cloudflare provider requires BROWSER binding in env')
    }

    // Dynamically import cloudflare puppeteer
    // @ts-ignore - Optional peer dependency
    const puppeteer = await import('@cloudflare/puppeteer').catch(() => {
      throw new Error('Package @cloudflare/puppeteer is required for Cloudflare provider. Run: npm install @cloudflare/puppeteer')
    })
    const browser = await puppeteer.default.launch(config.env.BROWSER)
    const page = await browser.newPage()

    // Apply viewport if specified
    if (config.viewport) {
      await page.setViewport(config.viewport)
    }

    // Initialize Stagehand for AI operations
    // @ts-ignore - Optional peer dependency
    const { Stagehand } = await import('@browserbasehq/stagehand').catch(() => {
      throw new Error('Package @browserbasehq/stagehand is required for Cloudflare provider. Run: npm install @browserbasehq/stagehand')
    })
    const stagehand = new Stagehand({
      env: 'LOCAL',
      enableCaching: false,
    })

    // Track if session is closed
    let closed = false

    // Create session object
    const session: BrowseSession = {
      async goto(url: string): Promise<void> {
        if (closed) {
          throw new Error('Session is closed')
        }

        // Validate URL
        try {
          new URL(url)
        } catch {
          throw new Error(`Invalid URL: ${url}`)
        }

        await page.goto(url)
      },

      async act(instruction: string): Promise<ActResult> {
        if (closed) {
          throw new Error('Session is closed')
        }

        try {
          const result = await stagehand.act(instruction)
          return {
            success: true,
            action: result?.action ?? instruction,
          }
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          }
        }
      },

      async extract<T = unknown>(instruction: string, schema?: unknown): Promise<T> {
        if (closed) {
          throw new Error('Session is closed')
        }

        const result = await stagehand.extract(instruction, { schema })
        return result as T
      },

      async observe(instruction?: string): Promise<ObserveResult> {
        if (closed) {
          throw new Error('Session is closed')
        }

        const result = await stagehand.observe(instruction)
        return result.map((item: any) => ({
          action: item.action ?? 'unknown',
          selector: item.selector,
          description: item.description ?? '',
        }))
      },

      async screenshot(options?: ScreenshotOptions): Promise<string> {
        if (closed) {
          throw new Error('Session is closed')
        }

        const screenshotOptions: any = {
          encoding: 'base64',
        }

        if (options?.fullPage) {
          screenshotOptions.fullPage = true
        }

        if (options?.type) {
          screenshotOptions.type = options.type
        }

        if (options?.quality && options.type === 'jpeg') {
          screenshotOptions.quality = options.quality
        }

        // Handle selector option by finding element first
        if (options?.selector) {
          const element = await page.$(options.selector)
          if (element) {
            const buffer = await element.screenshot(screenshotOptions)
            return typeof buffer === 'string' ? buffer : buffer.toString('base64')
          }
        }

        const buffer = await page.screenshot(screenshotOptions)
        return typeof buffer === 'string' ? buffer : buffer.toString('base64')
      },

      async close(): Promise<void> {
        if (closed) {
          return // Already closed, no-op
        }

        closed = true

        try {
          await stagehand.close()
        } catch {
          // Ignore stagehand close errors
        }

        try {
          await page.close()
        } catch {
          // Ignore page close errors
        }

        try {
          await browser.close()
        } catch {
          // Ignore browser close errors
        }
      },
    }

    return session
  }
}

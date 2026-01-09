/**
 * Browserbase Provider
 *
 * Implements the BrowseProvider interface using the Browserbase SDK
 * for cloud browser automation with live view support.
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
 * Browserbase provider implementation
 */
export class BrowserbaseBrowseProvider implements BrowseProvider {
  async init(config: BrowseInitConfig): Promise<BrowseSession> {
    // Validate credentials
    if (!config.env?.BROWSERBASE_API_KEY) {
      throw new Error('Browserbase provider requires BROWSERBASE_API_KEY in env')
    }

    if (!config.env?.BROWSERBASE_PROJECT_ID) {
      throw new Error('Browserbase provider requires BROWSERBASE_PROJECT_ID in env')
    }

    // Initialize Browserbase SDK
    // @ts-ignore - Optional peer dependency
    const { Browserbase } = await import('@browserbasehq/sdk')
    const browserbase = new Browserbase({
      apiKey: config.env.BROWSERBASE_API_KEY,
    })

    // Create session with options
    const sessionOptions: any = {
      projectId: config.env.BROWSERBASE_PROJECT_ID,
    }

    if (config.liveView) {
      sessionOptions.keepAlive = true
    }

    const browserSession = await browserbase.sessions.create(sessionOptions)

    // Connect via puppeteer-core
    // @ts-ignore - Optional peer dependency
    const puppeteer = await import('puppeteer-core')
    const browser = await puppeteer.default.connect({
      browserWSEndpoint: browserSession.connectUrl,
    })

    const page = await browser.newPage()

    // Apply viewport if specified
    if (config.viewport) {
      await page.setViewport(config.viewport)
    }

    // Initialize Stagehand for AI operations
    // @ts-ignore - Optional peer dependency
    const { Stagehand } = await import('@browserbasehq/stagehand')
    const stagehand = new Stagehand({
      env: 'BROWSERBASE',
      enableCaching: false,
      browserbaseSessionID: browserSession.id,
    })

    await stagehand.init()

    // Track if session is closed
    let closed = false

    // Create session object
    const session: BrowseSession = {
      // Live view URL (only available for browserbase with liveView enabled)
      liveViewUrl: config.liveView ? browserSession.liveUrl : undefined,

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

        await stagehand.page.goto(url)
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
          const element = await stagehand.page.$(options.selector)
          if (element) {
            const buffer = await element.screenshot(screenshotOptions)
            return typeof buffer === 'string' ? buffer : buffer.toString('base64')
          }
        }

        const buffer = await stagehand.page.screenshot(screenshotOptions)
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
          await browser.close()
        } catch {
          // Ignore browser close errors
        }
      },
    }

    return session
  }
}

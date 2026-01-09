/**
 * Type stubs for optional browser automation dependencies
 *
 * These modules are optional and should be installed separately when needed:
 * - @browserbasehq/sdk
 * - @browserbasehq/stagehand
 * - puppeteer-core
 * - @cloudflare/puppeteer
 */

declare module '@browserbasehq/sdk' {
  export interface SessionCreateOptions {
    projectId: string
    keepAlive?: boolean
  }

  export interface BrowserSession {
    id: string
    connectUrl: string
    liveUrl?: string
  }

  export interface Sessions {
    create(options: SessionCreateOptions): Promise<BrowserSession>
  }

  export class Browserbase {
    constructor(options: { apiKey: string })
    sessions: Sessions
  }
}

declare module 'puppeteer-core' {
  export interface Viewport {
    width: number
    height: number
    deviceScaleFactor?: number
    isMobile?: boolean
    hasTouch?: boolean
    isLandscape?: boolean
  }

  export interface Page {
    goto(url: string, options?: { waitUntil?: string | string[] }): Promise<unknown>
    setViewport(viewport: Viewport): Promise<void>
    screenshot(options?: { type?: string; encoding?: string }): Promise<string | Buffer>
    close(): Promise<void>
    content(): Promise<string>
    evaluate<T>(fn: (...args: unknown[]) => T, ...args: unknown[]): Promise<T>
  }

  export interface Browser {
    newPage(): Promise<Page>
    close(): Promise<void>
  }

  const puppeteer: {
    connect(options: { browserWSEndpoint: string }): Promise<Browser>
  }

  export default puppeteer
}

declare module '@browserbasehq/stagehand' {
  export interface StagehandOptions {
    env?: string
    enableCaching?: boolean
    browserbaseSessionID?: string
  }

  export interface ActResult {
    action?: string
    success?: boolean
    message?: string
  }

  export interface ObserveItem {
    action?: string
    selector?: string
    description?: string
  }

  export interface ExtractOptions {
    schema?: unknown
  }

  export interface ElementHandle {
    screenshot(options?: Record<string, unknown>): Promise<Buffer | string>
  }

  export interface StagehandPage {
    goto(url: string): Promise<void>
    $(selector: string): Promise<ElementHandle | null>
    screenshot(options?: Record<string, unknown>): Promise<Buffer | string>
  }

  export class Stagehand {
    constructor(options: StagehandOptions)
    init(): Promise<void>
    page: StagehandPage
    act(instruction: string): Promise<ActResult | null>
    observe(instruction?: string): Promise<ObserveItem[]>
    extract<T = unknown>(instruction: string, options?: ExtractOptions): Promise<T>
    close(): Promise<void>
  }
}

declare module '@cloudflare/puppeteer' {
  export interface Viewport {
    width: number
    height: number
  }

  export interface ElementHandle {
    screenshot(options?: Record<string, unknown>): Promise<string | Buffer>
  }

  export interface Page {
    goto(url: string): Promise<unknown>
    setViewport(viewport: Viewport): Promise<void>
    screenshot(options?: Record<string, unknown>): Promise<string | Buffer>
    close(): Promise<void>
    content(): Promise<string>
    evaluate<T>(fn: (...args: unknown[]) => T, ...args: unknown[]): Promise<T>
    $(selector: string): Promise<ElementHandle | null>
  }

  export interface Browser {
    newPage(): Promise<Page>
    close(): Promise<void>
  }

  const puppeteer: {
    launch(binding: unknown, options?: Record<string, unknown>): Promise<Browser>
  }

  export default puppeteer
}

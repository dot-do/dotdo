/**
 * Zapier App Definition
 *
 * Main App class for defining Zapier-compatible apps with triggers, actions, and searches.
 */

import type {
  AppConfig,
  TriggerConfig,
  ActionConfig,
  SearchConfig,
  Bundle,
  ValidationResult,
  ZapierExportFormat,
  BeforeRequestMiddleware,
  AfterResponseMiddleware,
} from './types'
import { createZObject } from './z-object'

// ============================================================================
// APP CLASS
// ============================================================================

/**
 * Zapier App definition
 */
export class App {
  readonly version: string
  readonly platformVersion: string
  readonly triggers: Record<string, TriggerConfig>
  readonly actions: Record<string, ActionConfig>
  readonly searches: Record<string, SearchConfig>
  readonly beforeRequest: BeforeRequestMiddleware[]
  readonly afterResponse: AfterResponseMiddleware[]

  constructor(config: AppConfig) {
    this.version = config.version
    this.platformVersion = config.platformVersion
    this.triggers = config.triggers || {}
    this.actions = config.actions || config.creates || {}
    this.searches = config.searches || {}
    this.beforeRequest = config.beforeRequest || []
    this.afterResponse = config.afterResponse || []
  }

  /**
   * Validate the app configuration
   */
  validate(): ValidationResult {
    const errors: string[] = []
    const warnings: string[] = []

    // Validate version
    if (!this.version) {
      errors.push('App version is required')
    }

    if (!this.platformVersion) {
      errors.push('Platform version is required')
    }

    // Validate triggers
    for (const [key, trigger] of Object.entries(this.triggers)) {
      if (!trigger.key) {
        errors.push(`Trigger "${key}" is missing key`)
      }
      if (!trigger.noun) {
        errors.push(`Trigger "${key}" is missing noun`)
      }
      if (!trigger.display?.label) {
        errors.push(`Trigger "${key}" is missing display.label`)
      }
      if (!trigger.display?.description) {
        errors.push(`Trigger "${key}" is missing display.description`)
      }
      if (!trigger.operation?.perform) {
        errors.push(`Trigger "${key}" is missing operation.perform`)
      }
    }

    // Validate actions
    for (const [key, action] of Object.entries(this.actions)) {
      if (!action.key) {
        errors.push(`Action "${key}" is missing key`)
      }
      if (!action.noun) {
        errors.push(`Action "${key}" is missing noun`)
      }
      if (!action.display?.label) {
        errors.push(`Action "${key}" is missing display.label`)
      }
      if (!action.operation?.perform) {
        errors.push(`Action "${key}" is missing operation.perform`)
      }
    }

    // Validate searches
    for (const [key, search] of Object.entries(this.searches)) {
      if (!search.key) {
        errors.push(`Search "${key}" is missing key`)
      }
      if (!search.noun) {
        errors.push(`Search "${key}" is missing noun`)
      }
      if (!search.operation?.perform) {
        errors.push(`Search "${key}" is missing operation.perform`)
      }

      // Validate searchOrCreateKey reference
      if (search.searchOrCreateKey && !this.actions[search.searchOrCreateKey]) {
        warnings.push(
          `Search "${key}" references non-existent action "${search.searchOrCreateKey}"`
        )
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    }
  }

  /**
   * List all trigger keys
   */
  listTriggers(): string[] {
    return Object.keys(this.triggers)
  }

  /**
   * List all action keys
   */
  listActions(): string[] {
    return Object.keys(this.actions)
  }

  /**
   * List all search keys
   */
  listSearches(): string[] {
    return Object.keys(this.searches)
  }

  /**
   * Get a trigger by key
   */
  getTrigger(key: string): TriggerConfig | undefined {
    return this.triggers[key]
  }

  /**
   * Get an action by key
   */
  getAction(key: string): ActionConfig | undefined {
    return this.actions[key]
  }

  /**
   * Get a search by key
   */
  getSearch(key: string): SearchConfig | undefined {
    return this.searches[key]
  }

  /**
   * Execute a trigger
   */
  async executeTrigger(
    key: string,
    bundle: Bundle
  ): Promise<unknown[]> {
    const trigger = this.triggers[key]
    if (!trigger) {
      throw new Error(`Trigger "${key}" not found`)
    }

    const z = createZObject({
      beforeRequest: this.beforeRequest,
      afterResponse: this.afterResponse,
      bundle,
    })

    return trigger.operation.perform(z, bundle)
  }

  /**
   * Execute an action
   */
  async executeAction(
    key: string,
    bundle: Bundle
  ): Promise<unknown> {
    const action = this.actions[key]
    if (!action) {
      throw new Error(`Action "${key}" not found`)
    }

    const z = createZObject({
      beforeRequest: this.beforeRequest,
      afterResponse: this.afterResponse,
      bundle,
    })

    return action.operation.perform(z, bundle)
  }

  /**
   * Execute a search
   */
  async executeSearch(
    key: string,
    bundle: Bundle
  ): Promise<unknown[]> {
    const search = this.searches[key]
    if (!search) {
      throw new Error(`Search "${key}" not found`)
    }

    const z = createZObject({
      beforeRequest: this.beforeRequest,
      afterResponse: this.afterResponse,
      bundle,
    })

    return search.operation.perform(z, bundle)
  }

  /**
   * Export app to Zapier CLI format
   */
  toZapierFormat(): ZapierExportFormat {
    return {
      version: this.version,
      platformVersion: this.platformVersion,
      triggers: this.triggers,
      creates: this.actions,
      searches: this.searches,
    }
  }

  /**
   * Create a handler for webhook requests
   */
  createWebhookHandler(triggerKey: string) {
    const trigger = this.triggers[triggerKey]
    if (!trigger) {
      throw new Error(`Trigger "${triggerKey}" not found`)
    }

    if (trigger.operation.type !== 'hook') {
      throw new Error(`Trigger "${triggerKey}" is not a webhook trigger`)
    }

    return async (request: Request, authData: Record<string, unknown> = {}) => {
      // Parse webhook payload
      let cleanedRequest: Record<string, unknown> = {}
      const contentType = request.headers.get('content-type') || ''

      if (contentType.includes('application/json')) {
        try {
          cleanedRequest = (await request.json()) as Record<string, unknown>
        } catch {
          cleanedRequest = {}
        }
      }

      const bundle: Bundle = {
        inputData: {},
        authData,
        cleanedRequest,
      }

      const z = createZObject({
        beforeRequest: this.beforeRequest,
        afterResponse: this.afterResponse,
        bundle,
      })

      const results = await trigger.operation.perform(z, bundle)

      return new Response(JSON.stringify({ success: true, data: results }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }
}

// ============================================================================
// APP BUILDER
// ============================================================================

/**
 * Fluent builder for creating apps
 */
export class AppBuilder {
  private config: Partial<AppConfig> = {
    triggers: {},
    actions: {},
    searches: {},
    beforeRequest: [],
    afterResponse: [],
  }

  version(version: string): this {
    this.config.version = version
    return this
  }

  platformVersion(version: string): this {
    this.config.platformVersion = version
    return this
  }

  trigger(key: string, trigger: TriggerConfig): this {
    this.config.triggers![key] = trigger
    return this
  }

  action(key: string, action: ActionConfig): this {
    this.config.actions![key] = action
    return this
  }

  search(key: string, search: SearchConfig): this {
    this.config.searches![key] = search
    return this
  }

  beforeRequest(middleware: BeforeRequestMiddleware): this {
    this.config.beforeRequest!.push(middleware)
    return this
  }

  afterResponse(middleware: AfterResponseMiddleware): this {
    this.config.afterResponse!.push(middleware)
    return this
  }

  build(): App {
    if (!this.config.version) {
      throw new Error('App version is required')
    }
    if (!this.config.platformVersion) {
      throw new Error('App platformVersion is required')
    }

    return new App(this.config as AppConfig)
  }
}

/**
 * Start building an app
 */
export function app(): AppBuilder {
  return new AppBuilder()
}

/**
 * Create an app from configuration
 */
export function createApp(config: AppConfig): App {
  return new App(config)
}

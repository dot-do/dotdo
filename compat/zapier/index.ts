/**
 * @dotdo/zapier - Zapier Platform Core Compatible Automation
 *
 * Drop-in compatible implementation of zapier-platform-core that runs
 * on dotdo's durable execution infrastructure.
 *
 * @example Basic App Definition
 * ```typescript
 * import { App, createZObject } from '@dotdo/zapier'
 *
 * const app = new App({
 *   version: '1.0.0',
 *   platformVersion: '14.0.0',
 *
 *   authentication: {
 *     type: 'oauth2',
 *     oauth2Config: {
 *       authorizeUrl: 'https://api.example.com/oauth/authorize',
 *       getAccessToken: async (z, bundle) => { ... },
 *       refreshAccessToken: async (z, bundle) => { ... },
 *     },
 *     test: async (z, bundle) => { ... },
 *   },
 *
 *   triggers: {
 *     new_contact: {
 *       key: 'new_contact',
 *       noun: 'Contact',
 *       display: { label: 'New Contact', description: 'Triggers on new contact' },
 *       operation: {
 *         type: 'polling',
 *         perform: async (z, bundle) => {
 *           const response = await z.request('https://api.example.com/contacts')
 *           return response.data
 *         },
 *       },
 *     },
 *   },
 *
 *   actions: {
 *     create_contact: {
 *       key: 'create_contact',
 *       noun: 'Contact',
 *       display: { label: 'Create Contact', description: 'Creates a contact' },
 *       operation: {
 *         perform: async (z, bundle) => {
 *           const response = await z.request({
 *             method: 'POST',
 *             url: 'https://api.example.com/contacts',
 *             body: bundle.inputData,
 *           })
 *           return response.data
 *         },
 *         inputFields: [
 *           { key: 'email', label: 'Email', required: true },
 *         ],
 *       },
 *     },
 *   },
 *
 *   searches: {
 *     find_contact: {
 *       key: 'find_contact',
 *       noun: 'Contact',
 *       display: { label: 'Find Contact', description: 'Finds a contact' },
 *       operation: {
 *         perform: async (z, bundle) => { ... },
 *       },
 *     },
 *   },
 * })
 * ```
 *
 * @see https://github.com/zapier/zapier-platform - Zapier Platform (API-compatible)
 */

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export * from './types'

// ============================================================================
// AUTH EXPORTS
// ============================================================================

export {
  Authentication,
  createBasicAuthHeader,
  createBearerAuthHeader,
  generateCodeVerifier,
  generateCodeChallenge,
  createAuthMiddleware,
  OAuth2Flow,
  SessionAuthFlow,
} from './auth'

// ============================================================================
// TRIGGER EXPORTS
// ============================================================================

export {
  Trigger,
  createPollingTrigger,
  createHookTrigger,
  PollingTriggerExecutor,
  WebhookTriggerManager,
  TriggerBuilder,
  trigger,
  sortByNewest,
  limitResults,
  filterResults,
  transformResults,
  deduplicateResults,
} from './triggers'

// ============================================================================
// ACTION EXPORTS
// ============================================================================

export {
  Action,
  createAction,
  ActionBuilder,
  action,
  stringField,
  requiredString,
  textField,
  numberField,
  integerField,
  booleanField,
  datetimeField,
  fileField,
  passwordField,
  selectField,
  dynamicField,
  searchField,
  listField,
  outputField,
  importantField,
  mergeWithDefaults,
  cleanInputData,
  transformInputData,
  formatOutputData,
} from './actions'

// ============================================================================
// SEARCH EXPORTS
// ============================================================================

export {
  Search,
  createSearch,
  SearchBuilder,
  search,
  createIdSearch,
  createFieldSearch,
  filterSearchResults,
  sortSearchResults,
  paginateSearchResults,
  createSearchResult,
} from './searches'

// ============================================================================
// WEBHOOK EXPORTS
// ============================================================================

export {
  WebhookHandler,
  WebhookSubscriptionManager,
  validateHmacSignature,
  generateVerificationToken,
  parseEventType,
  extractWebhookData,
  createWebhookResponse,
  webhookSuccess,
  webhookError,
  WebhookRetryManager,
} from './webhook'

// ============================================================================
// FIELDS EXPORTS
// ============================================================================

export {
  DynamicFieldResolver,
  FieldDependencyGraph,
  validateFieldValues,
  transformFieldValues,
  generateSampleData,
  flattenFields,
  unflattenData,
} from './fields'

// ============================================================================
// Z OBJECT EXPORTS
// ============================================================================

export {
  createZObject,
  HydrationManager,
  get,
  post,
  put,
  patch,
  del,
  withAuth,
  withHeaders,
  withParams,
  addHeaderMiddleware,
  authMiddleware,
  expiredAuthMiddleware,
  rateLimitMiddleware,
} from './z-object'
export type { CreateZObjectOptions } from './z-object'

// ============================================================================
// APP CLASS
// ============================================================================

import type {
  AppConfig,
  TriggerConfig,
  ActionConfig,
  SearchConfig,
  ResourceConfig,
  Bundle,
  ZObject,
  ValidationResult,
  ZapierExportFormat,
  BeforeRequestMiddleware,
  AfterResponseMiddleware,
  DehydrateFunc,
} from './types'
import { Authentication } from './auth'
import { Trigger } from './triggers'
import { Action } from './actions'
import { Search } from './searches'
import { createZObject, HydrationManager } from './z-object'
import { DynamicFieldResolver } from './fields'

/**
 * Zapier App definition
 */
export class App {
  readonly version: string
  readonly platformVersion: string
  readonly authentication?: Authentication
  readonly triggers: Record<string, TriggerConfig>
  readonly actions: Record<string, ActionConfig>
  readonly searches: Record<string, SearchConfig>
  readonly resources: Record<string, ResourceConfig>
  readonly beforeRequest: BeforeRequestMiddleware[]
  readonly afterResponse: AfterResponseMiddleware[]
  readonly hydrators: Record<string, DehydrateFunc>

  private config: AppConfig
  private hydrationManager: HydrationManager
  private fieldResolver: DynamicFieldResolver

  constructor(config: AppConfig) {
    this.version = config.version
    this.platformVersion = config.platformVersion
    this.triggers = config.triggers || {}
    this.actions = config.actions || config.creates || {}
    this.searches = config.searches || {}
    this.resources = config.resources || {}
    this.beforeRequest = config.beforeRequest || []
    this.afterResponse = config.afterResponse || []
    this.hydrators = config.hydrators || {}
    this.config = config

    if (config.authentication) {
      this.authentication = new Authentication(config.authentication)
    }

    this.hydrationManager = new HydrationManager()
    this.fieldResolver = new DynamicFieldResolver(
      this.triggers,
      this.actions,
      this.searches
    )

    // Register hydrators
    for (const [name, func] of Object.entries(this.hydrators)) {
      // Hydrators are registered on-demand during dehydration
    }
  }

  /**
   * Create a Z object configured for this app
   */
  createZObject(bundle?: Bundle): ZObject {
    return createZObject({
      beforeRequest: this.beforeRequest,
      afterResponse: this.afterResponse,
      bundle,
      hydrationStore: this.hydrationManager.getStore(),
    })
  }

  /**
   * Export app in Zapier CLI format
   */
  toZapierFormat(): ZapierExportFormat {
    return {
      version: this.version,
      platformVersion: this.platformVersion,
      authentication: this.config.authentication,
      triggers: this.triggers,
      creates: this.actions,
      searches: this.searches,
      resources: this.resources,
    }
  }

  /**
   * Validate app structure
   */
  validate(): ValidationResult {
    const errors: string[] = []
    const warnings: string[] = []

    // Validate version
    if (!this.version || this.version.trim() === '') {
      errors.push('App version is required')
    }

    // Validate triggers
    for (const [key, trigger] of Object.entries(this.triggers)) {
      if (!trigger.key || trigger.key.trim() === '') {
        errors.push(`Trigger "${key}" is missing a key`)
      }
      if (!trigger.noun || trigger.noun.trim() === '') {
        errors.push(`Trigger "${key}" is missing a noun`)
      }
      if (!trigger.display?.label || trigger.display.label.trim() === '') {
        errors.push(`Trigger "${key}" is missing a display label`)
      }
      if (!trigger.operation?.perform) {
        errors.push(`Trigger "${key}" is missing a perform function`)
      }

      // Validate hook triggers
      if (trigger.operation?.type === 'hook') {
        const op = trigger.operation
        if (!op.performSubscribe) {
          errors.push(`Hook trigger "${key}" is missing performSubscribe`)
        }
        if (!op.performUnsubscribe) {
          errors.push(`Hook trigger "${key}" is missing performUnsubscribe`)
        }
      }
    }

    // Validate actions
    for (const [key, action] of Object.entries(this.actions)) {
      if (!action.key || action.key.trim() === '') {
        errors.push(`Action "${key}" is missing a key`)
      }
      if (!action.noun || action.noun.trim() === '') {
        errors.push(`Action "${key}" is missing a noun`)
      }
      if (!action.display?.label || action.display.label.trim() === '') {
        errors.push(`Action "${key}" is missing a display label`)
      }
      if (!action.operation?.perform) {
        errors.push(`Action "${key}" is missing a perform function`)
      }
    }

    // Validate searches
    for (const [key, search] of Object.entries(this.searches)) {
      if (!search.key || search.key.trim() === '') {
        errors.push(`Search "${key}" is missing a key`)
      }
      if (!search.noun || search.noun.trim() === '') {
        errors.push(`Search "${key}" is missing a noun`)
      }
      if (!search.display?.label || search.display.label.trim() === '') {
        errors.push(`Search "${key}" is missing a display label`)
      }
      if (!search.operation?.perform) {
        errors.push(`Search "${key}" is missing a perform function`)
      }

      // Validate searchOrCreateKey references an existing action
      if (search.searchOrCreateKey && !this.actions[search.searchOrCreateKey]) {
        warnings.push(
          `Search "${key}" has searchOrCreateKey "${search.searchOrCreateKey}" which doesn't exist`
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
   * Execute a trigger
   */
  async executeTrigger(
    triggerKey: string,
    bundle: Bundle,
    z?: ZObject
  ): Promise<unknown[]> {
    const trigger = this.triggers[triggerKey]
    if (!trigger) {
      throw new Error(`Trigger "${triggerKey}" not found`)
    }

    const zObj = z || this.createZObject(bundle)
    return trigger.operation.perform(zObj, bundle)
  }

  /**
   * Execute an action
   */
  async executeAction(
    actionKey: string,
    bundle: Bundle,
    z?: ZObject
  ): Promise<unknown> {
    const action = this.actions[actionKey]
    if (!action) {
      throw new Error(`Action "${actionKey}" not found`)
    }

    const zObj = z || this.createZObject(bundle)
    return action.operation.perform(zObj, bundle)
  }

  /**
   * Execute a search
   */
  async executeSearch(
    searchKey: string,
    bundle: Bundle,
    z?: ZObject
  ): Promise<unknown[]> {
    const search = this.searches[searchKey]
    if (!search) {
      throw new Error(`Search "${searchKey}" not found`)
    }

    const zObj = z || this.createZObject(bundle)
    return search.operation.perform(zObj, bundle)
  }

  /**
   * Get a trigger wrapper
   */
  getTrigger(key: string): Trigger | undefined {
    const config = this.triggers[key]
    return config ? new Trigger(config) : undefined
  }

  /**
   * Get an action wrapper
   */
  getAction(key: string): Action | undefined {
    const config = this.actions[key]
    return config ? new Action(config) : undefined
  }

  /**
   * Get a search wrapper
   */
  getSearch(key: string): Search | undefined {
    const config = this.searches[key]
    return config ? new Search(config) : undefined
  }

  /**
   * Test authentication
   */
  async testAuth(bundle: Bundle, z?: ZObject): Promise<unknown> {
    if (!this.authentication) {
      throw new Error('No authentication configured')
    }

    const zObj = z || this.createZObject(bundle)
    return this.authentication.test(zObj, bundle)
  }

  /**
   * Get field resolver for this app
   */
  getFieldResolver(): DynamicFieldResolver {
    return this.fieldResolver
  }

  /**
   * Get hydration manager for this app
   */
  getHydrationManager(): HydrationManager {
    return this.hydrationManager
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
}

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export default App

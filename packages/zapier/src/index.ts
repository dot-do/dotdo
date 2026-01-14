/**
 * @dotdo/zapier - Zapier Platform Core Compatibility Layer
 *
 * A zapier-platform-core compatible SDK for building automation integrations
 * that can run on edge environments (Cloudflare Workers, Deno, etc.).
 *
 * Features:
 * - Full trigger, action, and search support
 * - OAuth2, API key, session, and custom authentication
 * - Webhook subscriptions and polling
 * - Dynamic fields and field validation
 * - Hydration for lazy loading
 * - Middleware system for request/response processing
 *
 * @example
 * ```typescript
 * import { App, createPollingTrigger, createAction, createSearch } from '@dotdo/zapier'
 *
 * const app = new App({
 *   version: '1.0.0',
 *   platformVersion: '14.0.0',
 *   triggers: {
 *     new_contact: createPollingTrigger({
 *       key: 'new_contact',
 *       noun: 'Contact',
 *       display: { label: 'New Contact', description: 'Triggers on new contacts' },
 *       perform: async (z, bundle) => {
 *         const response = await z.request({ url: 'https://api.example.com/contacts' })
 *         return response.data as unknown[]
 *       },
 *     }),
 *   },
 *   actions: {
 *     create_contact: createAction({
 *       key: 'create_contact',
 *       noun: 'Contact',
 *       display: { label: 'Create Contact', description: 'Creates a new contact' },
 *       perform: async (z, bundle) => {
 *         const response = await z.request({
 *           url: 'https://api.example.com/contacts',
 *           method: 'POST',
 *           json: bundle.inputData,
 *         })
 *         return response.data
 *       },
 *       inputFields: [
 *         { key: 'email', label: 'Email', required: true },
 *         { key: 'name', label: 'Name' },
 *       ],
 *     }),
 *   },
 *   searches: {},
 * })
 * ```
 *
 * @packageDocumentation
 */

// Core app
export { App, AppBuilder, app, createApp } from './app'

// Types
export type {
  // Config types
  AppConfig,
  TriggerConfig,
  PollingTriggerConfig,
  HookTriggerConfig,
  ActionConfig,
  SearchConfig,
  ResourceConfig,
  AuthenticationConfig,
  ValidationResult,
  ZapierExportFormat,
  // Operation types
  PollingTriggerOperation,
  HookTriggerOperation,
  ActionOperation,
  SearchOperation,
  BaseOperationConfig,
  PerformFunction,
  // Input/output types
  InputField,
  InputFieldType,
  InputFieldOrFunction,
  DynamicInputFieldFunction,
  OutputField,
  DisplayConfig,
  // Bundle types
  Bundle,
  BundleMeta,
  RawRequest,
  // Z object types
  ZObject,
  ZRequestOptions,
  ZResponse,
  ZConsole,
  ZJSON,
  ZErrors,
  ZCursor,
  DehydrateFunc,
  // Auth types
  OAuth2Config,
  SessionConfig,
  CustomAuthConfig,
  // Middleware types
  BeforeRequestMiddleware,
  AfterResponseMiddleware,
  // Webhook types
  WebhookSubscription,
  WebhookHandlerResult,
  HydrationPayload,
  StashedFile,
} from './types'

// Errors
export {
  ZapierError,
  ExpiredAuthError,
  RefreshAuthError,
  HaltedError,
  ThrottledError,
  ResponseError,
} from './types'

// Z object
export {
  createZObject,
  HydrationManager,
  // Request helpers
  get,
  post,
  put,
  patch,
  del,
  withAuth,
  withHeaders,
  withParams,
  // Middleware helpers
  addHeaderMiddleware,
  authMiddleware,
  expiredAuthMiddleware,
  rateLimitMiddleware,
} from './z-object'

export type { CreateZObjectOptions } from './z-object'

// Authentication
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

// Triggers
export {
  Trigger,
  createPollingTrigger,
  createHookTrigger,
  PollingTriggerExecutor,
  WebhookTriggerManager,
  TriggerBuilder,
  trigger,
  // Utilities
  sortByNewest,
  limitResults,
  filterResults,
  transformResults,
  deduplicateResults,
} from './triggers'

// Actions
export {
  Action,
  createAction,
  ActionBuilder,
  action,
  // Field builders
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
  // Output field builders
  outputField,
  importantField,
  // Utilities
  mergeWithDefaults,
  cleanInputData,
  transformInputData,
  formatOutputData,
} from './actions'

// Searches
export {
  Search,
  createSearch,
  SearchBuilder,
  search,
  // Utilities
  createIdSearch,
  createFieldSearch,
  filterSearchResults,
  sortSearchResults,
  paginateSearchResults,
  createSearchResult,
} from './searches'

// Webhooks
export {
  WebhookHandler,
  WebhookSubscriptionManager,
  WebhookRetryManager,
  // Utilities
  validateHmacSignature,
  generateVerificationToken,
  parseEventType,
  extractWebhookData,
  createWebhookResponse,
  webhookSuccess,
  webhookError,
} from './webhook'

export type { WebhookDelivery } from './webhook'

// Fields
export {
  DynamicFieldResolver,
  FieldDependencyGraph,
  validateFieldValues,
  transformFieldValues,
  generateSampleData,
  flattenFields,
  unflattenData,
} from './fields'

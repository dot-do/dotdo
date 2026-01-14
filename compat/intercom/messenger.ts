/**
 * @dotdo/intercom - Messenger Customization Resource
 *
 * Comprehensive Intercom Messenger customization with support for:
 * - Widget configuration (colors, position, padding)
 * - Home screen apps and cards
 * - Help center integration
 * - Custom actions
 * - Identity verification
 * - Launcher customization
 * - Message templates
 *
 * @example Widget Configuration
 * ```typescript
 * // Configure messenger appearance
 * await client.messenger.configureMessenger({
 *   color: '#0066FF',
 *   position: 'right',
 *   alignment: 'bottom',
 *   horizontalPadding: 20,
 *   verticalPadding: 20,
 * })
 *
 * // Get current config
 * const config = await client.messenger.getMessengerConfig()
 * ```
 *
 * @example Home Screen
 * ```typescript
 * // Add home screen cards
 * await client.messenger.addHomeScreenCard({
 *   type: 'conversation_card',
 *   title: 'Talk to Sales',
 *   body: 'Get help from our team',
 *   action: { type: 'start_conversation' },
 * })
 *
 * // Configure apps
 * await client.messenger.setHomeScreenApps([
 *   { id: 'app_123', enabled: true },
 *   { id: 'app_456', enabled: false },
 * ])
 * ```
 *
 * @example Help Center
 * ```typescript
 * // Enable help center
 * await client.messenger.enableHelpCenter(['collection_123'])
 *
 * // Search articles
 * const results = await client.messenger.searchHelpArticles('getting started')
 * ```
 *
 * @example Custom Actions
 * ```typescript
 * // Register custom action
 * await client.messenger.registerCustomAction('book_demo', {
 *   label: 'Book a Demo',
 *   handler: async (context) => {
 *     // Handle action
 *   },
 * })
 *
 * // Trigger action
 * await client.messenger.triggerCustomAction('book_demo', { userId: 'user_123' })
 * ```
 *
 * @example Identity Verification
 * ```typescript
 * // Set identity verification for secure mode
 * await client.messenger.setIdentityVerification({
 *   userId: 'user_123',
 *   userHash: 'hmac_hash_here',
 *   email: 'user@example.com',
 * })
 * ```
 *
 * @module @dotdo/intercom/messenger
 */

import type { RequestOptions, Article, ListResponse, Pages } from './types'
import type { IntercomClientInterface } from './contacts'

// =============================================================================
// Types
// =============================================================================

/**
 * Messenger position on the page
 */
export type MessengerPosition = 'left' | 'right'

/**
 * Messenger alignment
 */
export type MessengerAlignment = 'top' | 'bottom'

/**
 * Messenger configuration options
 */
export interface MessengerConfig {
  /** Primary color (hex) */
  color?: string
  /** Secondary color (hex) */
  secondaryColor?: string
  /** Position on page */
  position?: MessengerPosition
  /** Vertical alignment */
  alignment?: MessengerAlignment
  /** Horizontal padding in pixels */
  horizontalPadding?: number
  /** Vertical padding in pixels */
  verticalPadding?: number
  /** Whether the launcher is visible */
  launcherVisible?: boolean
  /** Custom launcher logo URL */
  launcherLogo?: string | null
  /** Whether to show the powered by Intercom badge */
  showPoweredBy?: boolean
  /** Background color for messenger */
  backgroundColor?: string
  /** Action color for buttons */
  actionColor?: string
}

/**
 * Stored messenger configuration with metadata
 */
export interface StoredMessengerConfig extends MessengerConfig {
  /** Configuration ID */
  id: string
  /** Workspace ID */
  workspaceId: string
  /** Creation timestamp */
  createdAt: number
  /** Last update timestamp */
  updatedAt: number
}

/**
 * Home screen card types
 */
export type HomeScreenCardType =
  | 'conversation_card'
  | 'article_card'
  | 'news_card'
  | 'app_card'
  | 'help_center_card'
  | 'custom_card'

/**
 * Card action types
 */
export type CardActionType =
  | 'start_conversation'
  | 'open_article'
  | 'open_url'
  | 'open_app'
  | 'trigger_custom_action'

/**
 * Card action configuration
 */
export interface CardAction {
  /** Action type */
  type: CardActionType
  /** Article ID for open_article */
  articleId?: string
  /** URL for open_url */
  url?: string
  /** App ID for open_app */
  appId?: string
  /** Custom action ID for trigger_custom_action */
  customActionId?: string
}

/**
 * Home screen card
 */
export interface HomeScreenCard {
  /** Card ID */
  id: string
  /** Card type */
  type: HomeScreenCardType
  /** Card title */
  title: string
  /** Card body/description */
  body: string
  /** Optional icon URL */
  icon?: string
  /** Action when card is clicked */
  action?: CardAction
  /** Display order */
  order: number
  /** Whether the card is enabled */
  enabled: boolean
  /** Creation timestamp */
  createdAt: number
  /** Last update timestamp */
  updatedAt: number
}

/**
 * Parameters for creating a home screen card
 */
export interface HomeScreenCardCreateParams {
  /** Card type */
  type: HomeScreenCardType
  /** Card title */
  title: string
  /** Card body/description */
  body: string
  /** Optional icon URL */
  icon?: string
  /** Action when card is clicked */
  action?: CardAction
  /** Whether the card is enabled */
  enabled?: boolean
}

/**
 * Home screen app configuration
 */
export interface HomeScreenApp {
  /** App ID */
  id: string
  /** App name */
  name?: string
  /** Whether the app is enabled on home screen */
  enabled: boolean
  /** Display order */
  order: number
}

/**
 * Help center configuration
 */
export interface HelpCenterConfig {
  /** Whether help center is enabled */
  enabled: boolean
  /** Collection IDs to show (null = all) */
  collectionIds: string[] | null
  /** Help center locale */
  locale: string
  /** Whether to show search */
  showSearch: boolean
  /** Last update timestamp */
  updatedAt: number
}

/**
 * Custom action handler
 */
export type CustomActionHandler = (context: CustomActionContext) => Promise<void>

/**
 * Custom action context passed to handlers
 */
export interface CustomActionContext {
  /** User/contact ID */
  userId?: string
  /** User email */
  email?: string
  /** Current conversation ID */
  conversationId?: string
  /** Custom data */
  data?: Record<string, unknown>
}

/**
 * Custom action configuration
 */
export interface CustomAction {
  /** Action ID */
  id: string
  /** Display label */
  label: string
  /** Optional description */
  description?: string
  /** Optional icon URL */
  icon?: string
  /** Whether the action is enabled */
  enabled: boolean
  /** Creation timestamp */
  createdAt: number
}

/**
 * Custom action registration params
 */
export interface CustomActionParams {
  /** Display label */
  label: string
  /** Optional description */
  description?: string
  /** Optional icon URL */
  icon?: string
  /** Handler function (stored locally, not sent to API) */
  handler?: CustomActionHandler
}

/**
 * Identity verification parameters
 */
export interface IdentityVerificationParams {
  /** User ID */
  userId: string
  /** HMAC hash of user ID */
  userHash: string
  /** Optional email */
  email?: string
  /** Optional name */
  name?: string
  /** Optional custom attributes */
  customAttributes?: Record<string, unknown>
}

/**
 * Stored identity verification
 */
export interface IdentityVerification {
  /** User ID */
  userId: string
  /** Whether verified */
  verified: boolean
  /** Verification timestamp */
  verifiedAt: number | null
  /** Email */
  email?: string
  /** Name */
  name?: string
}

/**
 * Custom launcher configuration
 */
export interface CustomLauncherConfig {
  /** Custom icon URL */
  icon?: string
  /** Badge count */
  badge?: number
  /** Tooltip text */
  tooltip?: string
}

/**
 * Messenger open options
 */
export interface MessengerOpenOptions {
  /** Pre-fill message */
  message?: string
  /** Open to specific article */
  articleId?: string
  /** Open to specific conversation */
  conversationId?: string
  /** Open help center */
  helpCenter?: boolean
}

/**
 * Message template
 */
export interface MessageTemplate {
  /** Template ID */
  id: string
  /** Template name */
  name: string
  /** Template content */
  content: string
  /** Optional attachments */
  attachments?: TemplateAttachment[]
  /** Template variables */
  variables?: string[]
  /** Creation timestamp */
  createdAt: number
  /** Last update timestamp */
  updatedAt: number
}

/**
 * Template attachment
 */
export interface TemplateAttachment {
  /** Attachment type */
  type: 'image' | 'file' | 'video'
  /** Attachment URL */
  url: string
  /** Attachment name */
  name: string
}

/**
 * Message template creation params
 */
export interface MessageTemplateCreateParams {
  /** Template name */
  name: string
  /** Template content */
  content: string
  /** Optional attachments */
  attachments?: TemplateAttachment[]
}

/**
 * Help article search result
 */
export interface HelpArticleSearchResult {
  /** Article */
  article: Article
  /** Search relevance score */
  score: number
  /** Highlighted snippet */
  snippet?: string
}

// =============================================================================
// Helper Functions
// =============================================================================

function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function createPages(page: number, perPage: number, total: number): Pages {
  const totalPages = Math.ceil(total / perPage)
  return {
    type: 'pages',
    page,
    per_page: perPage,
    total_pages: totalPages,
    ...(page < totalPages ? { next: { page: page + 1 } } : {}),
  }
}

// =============================================================================
// Messenger Resource (API Client)
// =============================================================================

/**
 * Messenger resource for API-backed customization
 *
 * This resource interacts with Intercom's API for messenger customization.
 *
 * @example
 * ```typescript
 * // Configure messenger
 * await client.messenger.configureMessenger({
 *   color: '#0066FF',
 *   position: 'right',
 * })
 *
 * // Register custom action
 * await client.messenger.registerCustomAction('book_demo', {
 *   label: 'Book a Demo',
 * })
 * ```
 */
export class MessengerResource {
  private client: IntercomClientInterface

  constructor(client: IntercomClientInterface) {
    this.client = client
  }

  // ===========================================================================
  // Widget Configuration
  // ===========================================================================

  /**
   * Configure messenger appearance and behavior
   *
   * @param config - Configuration options
   * @param options - Request options
   * @returns Updated configuration
   *
   * @example
   * ```typescript
   * await client.messenger.configureMessenger({
   *   color: '#0066FF',
   *   position: 'right',
   *   alignment: 'bottom',
   *   horizontalPadding: 20,
   *   verticalPadding: 20,
   * })
   * ```
   */
  async configureMessenger(
    config: MessengerConfig,
    options?: RequestOptions
  ): Promise<StoredMessengerConfig> {
    return this.client._request(
      'PUT',
      '/messenger/settings',
      {
        primary_color: config.color,
        secondary_color: config.secondaryColor,
        launcher_position: config.position,
        launcher_alignment: config.alignment,
        horizontal_padding: config.horizontalPadding,
        vertical_padding: config.verticalPadding,
        show_powered_by: config.showPoweredBy,
        background_color: config.backgroundColor,
        action_color: config.actionColor,
      },
      options
    )
  }

  /**
   * Get current messenger configuration
   *
   * @param options - Request options
   * @returns Current configuration
   */
  async getMessengerConfig(options?: RequestOptions): Promise<StoredMessengerConfig> {
    return this.client._request('GET', '/messenger/settings', undefined, options)
  }

  /**
   * Update launcher logo
   *
   * @param imageUrl - Logo image URL (or null to remove)
   * @param options - Request options
   * @returns Updated configuration
   */
  async updateLauncherLogo(
    imageUrl: string | null,
    options?: RequestOptions
  ): Promise<StoredMessengerConfig> {
    return this.client._request(
      'PUT',
      '/messenger/settings',
      { launcher_logo_url: imageUrl },
      options
    )
  }

  /**
   * Set launcher visibility
   *
   * @param visible - Whether launcher should be visible
   * @param options - Request options
   * @returns Updated configuration
   */
  async setLauncherVisibility(
    visible: boolean,
    options?: RequestOptions
  ): Promise<StoredMessengerConfig> {
    return this.client._request(
      'PUT',
      '/messenger/settings',
      { launcher_visible: visible },
      options
    )
  }

  // ===========================================================================
  // Home Screen
  // ===========================================================================

  /**
   * Configure home screen apps
   *
   * @param apps - Array of app configurations
   * @param options - Request options
   * @returns Updated app list
   */
  async setHomeScreenApps(
    apps: HomeScreenApp[],
    options?: RequestOptions
  ): Promise<{ apps: HomeScreenApp[] }> {
    return this.client._request(
      'PUT',
      '/messenger/home',
      { apps: apps.map((a) => ({ app_id: a.id, enabled: a.enabled, order: a.order })) },
      options
    )
  }

  /**
   * Add a home screen card
   *
   * @param params - Card creation parameters
   * @param options - Request options
   * @returns Created card
   */
  async addHomeScreenCard(
    params: HomeScreenCardCreateParams,
    options?: RequestOptions
  ): Promise<HomeScreenCard> {
    return this.client._request(
      'POST',
      '/messenger/home/cards',
      {
        type: params.type,
        title: params.title,
        body: params.body,
        icon: params.icon,
        action: params.action,
        enabled: params.enabled ?? true,
      },
      options
    )
  }

  /**
   * Remove a home screen card
   *
   * @param cardId - Card ID to remove
   * @param options - Request options
   * @returns Deletion confirmation
   */
  async removeHomeScreenCard(
    cardId: string,
    options?: RequestOptions
  ): Promise<{ id: string; deleted: true }> {
    return this.client._request('DELETE', `/messenger/home/cards/${cardId}`, undefined, options)
  }

  /**
   * Reorder home screen cards
   *
   * @param cardIds - Array of card IDs in desired order
   * @param options - Request options
   * @returns Updated card list
   */
  async reorderHomeScreenCards(
    cardIds: string[],
    options?: RequestOptions
  ): Promise<{ cards: HomeScreenCard[] }> {
    return this.client._request(
      'PUT',
      '/messenger/home/cards/reorder',
      { card_ids: cardIds },
      options
    )
  }

  // ===========================================================================
  // Help Center Integration
  // ===========================================================================

  /**
   * Enable help center in messenger
   *
   * @param collectionIds - Optional collection IDs to show (null = all)
   * @param options - Request options
   * @returns Help center configuration
   */
  async enableHelpCenter(
    collectionIds?: string[],
    options?: RequestOptions
  ): Promise<HelpCenterConfig> {
    return this.client._request(
      'PUT',
      '/messenger/help_center',
      {
        enabled: true,
        collection_ids: collectionIds ?? null,
      },
      options
    )
  }

  /**
   * Disable help center in messenger
   *
   * @param options - Request options
   * @returns Help center configuration
   */
  async disableHelpCenter(options?: RequestOptions): Promise<HelpCenterConfig> {
    return this.client._request('PUT', '/messenger/help_center', { enabled: false }, options)
  }

  /**
   * Set help center locale
   *
   * @param locale - Locale code (e.g., 'en', 'es', 'fr')
   * @param options - Request options
   * @returns Updated help center configuration
   */
  async setHelpCenterLocale(locale: string, options?: RequestOptions): Promise<HelpCenterConfig> {
    return this.client._request('PUT', '/messenger/help_center', { locale }, options)
  }

  /**
   * Search help center articles
   *
   * @param query - Search query
   * @param options - Request options
   * @returns Search results
   */
  async searchHelpArticles(
    query: string,
    options?: RequestOptions
  ): Promise<ListResponse<HelpArticleSearchResult>> {
    return this.client._request(
      'GET',
      '/help_center/articles/search',
      { phrase: query },
      options
    )
  }

  /**
   * Get a help center article
   *
   * @param articleId - Article ID
   * @param options - Request options
   * @returns Article
   */
  async getArticle(articleId: string, options?: RequestOptions): Promise<Article> {
    return this.client._request('GET', `/articles/${articleId}`, undefined, options)
  }

  // ===========================================================================
  // Custom Actions
  // ===========================================================================

  /**
   * Register a custom action
   *
   * @param actionId - Unique action identifier
   * @param params - Action configuration
   * @param options - Request options
   * @returns Registered action
   */
  async registerCustomAction(
    actionId: string,
    params: CustomActionParams,
    options?: RequestOptions
  ): Promise<CustomAction> {
    return this.client._request(
      'POST',
      '/messenger/custom_actions',
      {
        id: actionId,
        label: params.label,
        description: params.description,
        icon: params.icon,
      },
      options
    )
  }

  /**
   * Trigger a custom action
   *
   * @param actionId - Action ID to trigger
   * @param context - Action context
   * @param options - Request options
   * @returns Trigger result
   */
  async triggerCustomAction(
    actionId: string,
    context: CustomActionContext,
    options?: RequestOptions
  ): Promise<{ triggered: true; actionId: string }> {
    return this.client._request(
      'POST',
      `/messenger/custom_actions/${actionId}/trigger`,
      {
        user_id: context.userId,
        email: context.email,
        conversation_id: context.conversationId,
        data: context.data,
      },
      options
    )
  }

  /**
   * Unregister a custom action
   *
   * @param actionId - Action ID to unregister
   * @param options - Request options
   * @returns Deletion confirmation
   */
  async unregisterCustomAction(
    actionId: string,
    options?: RequestOptions
  ): Promise<{ id: string; deleted: true }> {
    return this.client._request(
      'DELETE',
      `/messenger/custom_actions/${actionId}`,
      undefined,
      options
    )
  }

  // ===========================================================================
  // Identity Verification
  // ===========================================================================

  /**
   * Set identity verification for secure mode
   *
   * @param params - Identity verification parameters
   * @param options - Request options
   * @returns Verification status
   */
  async setIdentityVerification(
    params: IdentityVerificationParams,
    options?: RequestOptions
  ): Promise<IdentityVerification> {
    return this.client._request(
      'POST',
      '/messenger/identity_verification',
      {
        user_id: params.userId,
        user_hash: params.userHash,
        email: params.email,
        name: params.name,
        custom_attributes: params.customAttributes,
      },
      options
    )
  }

  /**
   * Verify identity with HMAC
   *
   * @param hmac - HMAC hash
   * @param options - Request options
   * @returns Verification result
   */
  async verifyIdentity(
    hmac: string,
    options?: RequestOptions
  ): Promise<{ verified: boolean; userId?: string }> {
    return this.client._request('POST', '/messenger/verify', { hmac }, options)
  }

  /**
   * Clear identity verification
   *
   * @param options - Request options
   * @returns Cleared status
   */
  async clearIdentity(options?: RequestOptions): Promise<{ cleared: true }> {
    return this.client._request('DELETE', '/messenger/identity_verification', undefined, options)
  }

  // ===========================================================================
  // Launcher Customization
  // ===========================================================================

  /**
   * Set custom launcher configuration
   *
   * @param config - Launcher configuration
   * @param options - Request options
   * @returns Updated configuration
   */
  async setCustomLauncher(
    config: CustomLauncherConfig,
    options?: RequestOptions
  ): Promise<CustomLauncherConfig> {
    return this.client._request(
      'PUT',
      '/messenger/launcher',
      {
        custom_icon: config.icon,
        badge_count: config.badge,
        tooltip: config.tooltip,
      },
      options
    )
  }

  /**
   * Show the messenger launcher
   *
   * @param options - Request options
   * @returns Status
   */
  async showLauncher(options?: RequestOptions): Promise<{ visible: true }> {
    return this.client._request('PUT', '/messenger/launcher', { visible: true }, options)
  }

  /**
   * Hide the messenger launcher
   *
   * @param options - Request options
   * @returns Status
   */
  async hideLauncher(options?: RequestOptions): Promise<{ visible: false }> {
    return this.client._request('PUT', '/messenger/launcher', { visible: false }, options)
  }

  /**
   * Open the messenger
   *
   * @param messengerOptions - Open options
   * @param options - Request options
   * @returns Status
   */
  async openMessenger(
    messengerOptions?: MessengerOpenOptions,
    options?: RequestOptions
  ): Promise<{ opened: true }> {
    return this.client._request(
      'POST',
      '/messenger/open',
      {
        message: messengerOptions?.message,
        article_id: messengerOptions?.articleId,
        conversation_id: messengerOptions?.conversationId,
        help_center: messengerOptions?.helpCenter,
      },
      options
    )
  }

  /**
   * Close the messenger
   *
   * @param options - Request options
   * @returns Status
   */
  async closeMessenger(options?: RequestOptions): Promise<{ closed: true }> {
    return this.client._request('POST', '/messenger/close', undefined, options)
  }

  // ===========================================================================
  // Message Templates
  // ===========================================================================

  /**
   * Create a message template
   *
   * @param params - Template creation parameters
   * @param options - Request options
   * @returns Created template
   */
  async createMessageTemplate(
    params: MessageTemplateCreateParams,
    options?: RequestOptions
  ): Promise<MessageTemplate> {
    // Extract variables from content ({{variable_name}})
    const variables = this.extractTemplateVariables(params.content)

    return this.client._request(
      'POST',
      '/messenger/templates',
      {
        name: params.name,
        content: params.content,
        attachments: params.attachments,
        variables,
      },
      options
    )
  }

  /**
   * List message templates
   *
   * @param options - Request options
   * @returns List of templates
   */
  async listMessageTemplates(options?: RequestOptions): Promise<ListResponse<MessageTemplate>> {
    return this.client._request('GET', '/messenger/templates', undefined, options)
  }

  /**
   * Send a message from a template
   *
   * @param templateId - Template ID
   * @param recipientId - Recipient contact ID
   * @param variables - Template variable values
   * @param options - Request options
   * @returns Send result
   */
  async sendFromTemplate(
    templateId: string,
    recipientId: string,
    variables?: Record<string, string>,
    options?: RequestOptions
  ): Promise<{ sent: true; messageId: string }> {
    return this.client._request(
      'POST',
      `/messenger/templates/${templateId}/send`,
      {
        recipient_id: recipientId,
        variables,
      },
      options
    )
  }

  /**
   * Extract template variables from content
   */
  private extractTemplateVariables(content: string): string[] {
    const matches = content.match(/\{\{([^}]+)\}\}/g) ?? []
    return matches.map((m) => m.slice(2, -2).trim())
  }
}

// =============================================================================
// Local Messenger Resource (DO Storage)
// =============================================================================

/**
 * Local/edge implementation of messenger customization
 *
 * Stores all configuration in Durable Object storage for edge-native operation
 * without requiring Intercom API calls.
 *
 * @example
 * ```typescript
 * import { MessengerLocal } from '@dotdo/intercom/messenger'
 *
 * const messenger = new MessengerLocal('workspace_123')
 *
 * // Configure locally
 * await messenger.configureMessenger({
 *   color: '#0066FF',
 *   position: 'right',
 * })
 *
 * // Register custom action with handler
 * await messenger.registerCustomAction('book_demo', {
 *   label: 'Book a Demo',
 *   handler: async (context) => {
 *     console.log('Demo booked for', context.userId)
 *   },
 * })
 * ```
 */
export class MessengerLocal {
  private workspaceId: string
  private config: StoredMessengerConfig | null = null
  private homeScreenCards: Map<string, HomeScreenCard> = new Map()
  private homeScreenApps: Map<string, HomeScreenApp> = new Map()
  private helpCenterConfig: HelpCenterConfig
  private customActions: Map<string, CustomAction> = new Map()
  private customActionHandlers: Map<string, CustomActionHandler> = new Map()
  private identityVerifications: Map<string, IdentityVerification> = new Map()
  private launcherConfig: CustomLauncherConfig = {}
  private launcherVisible: boolean = true
  private messengerOpen: boolean = false
  private messageTemplates: Map<string, MessageTemplate> = new Map()

  constructor(workspaceId: string) {
    this.workspaceId = workspaceId
    this.helpCenterConfig = {
      enabled: false,
      collectionIds: null,
      locale: 'en',
      showSearch: true,
      updatedAt: Math.floor(Date.now() / 1000),
    }
  }

  // ===========================================================================
  // Widget Configuration
  // ===========================================================================

  /**
   * Configure messenger appearance and behavior
   */
  async configureMessenger(config: MessengerConfig): Promise<StoredMessengerConfig> {
    const now = Math.floor(Date.now() / 1000)

    if (this.config) {
      this.config = {
        ...this.config,
        ...config,
        updatedAt: now,
      }
    } else {
      this.config = {
        id: generateId('messenger_config'),
        workspaceId: this.workspaceId,
        ...config,
        createdAt: now,
        updatedAt: now,
      }
    }

    return this.config
  }

  /**
   * Get current messenger configuration
   */
  async getMessengerConfig(): Promise<StoredMessengerConfig> {
    if (!this.config) {
      const now = Math.floor(Date.now() / 1000)
      this.config = {
        id: generateId('messenger_config'),
        workspaceId: this.workspaceId,
        color: '#0066FF',
        position: 'right',
        alignment: 'bottom',
        horizontalPadding: 20,
        verticalPadding: 20,
        launcherVisible: true,
        launcherLogo: null,
        showPoweredBy: true,
        createdAt: now,
        updatedAt: now,
      }
    }
    return this.config
  }

  /**
   * Update launcher logo
   */
  async updateLauncherLogo(imageUrl: string | null): Promise<StoredMessengerConfig> {
    return this.configureMessenger({ launcherLogo: imageUrl })
  }

  /**
   * Set launcher visibility
   */
  async setLauncherVisibility(visible: boolean): Promise<StoredMessengerConfig> {
    return this.configureMessenger({ launcherVisible: visible })
  }

  // ===========================================================================
  // Home Screen
  // ===========================================================================

  /**
   * Configure home screen apps
   */
  async setHomeScreenApps(apps: HomeScreenApp[]): Promise<{ apps: HomeScreenApp[] }> {
    this.homeScreenApps.clear()
    for (const app of apps) {
      this.homeScreenApps.set(app.id, app)
    }
    return { apps: Array.from(this.homeScreenApps.values()) }
  }

  /**
   * Add a home screen card
   */
  async addHomeScreenCard(params: HomeScreenCardCreateParams): Promise<HomeScreenCard> {
    const id = generateId('card')
    const now = Math.floor(Date.now() / 1000)
    const order = this.homeScreenCards.size

    const card: HomeScreenCard = {
      id,
      type: params.type,
      title: params.title,
      body: params.body,
      icon: params.icon,
      action: params.action,
      order,
      enabled: params.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    }

    this.homeScreenCards.set(id, card)
    return card
  }

  /**
   * Remove a home screen card
   */
  async removeHomeScreenCard(cardId: string): Promise<{ id: string; deleted: true }> {
    if (!this.homeScreenCards.has(cardId)) {
      throw new Error(`Card not found: ${cardId}`)
    }
    this.homeScreenCards.delete(cardId)
    return { id: cardId, deleted: true }
  }

  /**
   * Reorder home screen cards
   */
  async reorderHomeScreenCards(cardIds: string[]): Promise<{ cards: HomeScreenCard[] }> {
    const reordered: HomeScreenCard[] = []
    const now = Math.floor(Date.now() / 1000)

    for (let i = 0; i < cardIds.length; i++) {
      const card = this.homeScreenCards.get(cardIds[i])
      if (card) {
        card.order = i
        card.updatedAt = now
        this.homeScreenCards.set(card.id, card)
        reordered.push(card)
      }
    }

    return { cards: reordered.sort((a, b) => a.order - b.order) }
  }

  /**
   * Get all home screen cards
   */
  async getHomeScreenCards(): Promise<HomeScreenCard[]> {
    return Array.from(this.homeScreenCards.values()).sort((a, b) => a.order - b.order)
  }

  // ===========================================================================
  // Help Center Integration
  // ===========================================================================

  /**
   * Enable help center in messenger
   */
  async enableHelpCenter(collectionIds?: string[]): Promise<HelpCenterConfig> {
    this.helpCenterConfig = {
      ...this.helpCenterConfig,
      enabled: true,
      collectionIds: collectionIds ?? null,
      updatedAt: Math.floor(Date.now() / 1000),
    }
    return this.helpCenterConfig
  }

  /**
   * Disable help center in messenger
   */
  async disableHelpCenter(): Promise<HelpCenterConfig> {
    this.helpCenterConfig = {
      ...this.helpCenterConfig,
      enabled: false,
      updatedAt: Math.floor(Date.now() / 1000),
    }
    return this.helpCenterConfig
  }

  /**
   * Set help center locale
   */
  async setHelpCenterLocale(locale: string): Promise<HelpCenterConfig> {
    this.helpCenterConfig = {
      ...this.helpCenterConfig,
      locale,
      updatedAt: Math.floor(Date.now() / 1000),
    }
    return this.helpCenterConfig
  }

  /**
   * Search help center articles (local implementation - requires article index)
   *
   * Note: This is a stub that returns empty results. In a full implementation,
   * this would integrate with the LocalArticlesResource.
   */
  async searchHelpArticles(query: string): Promise<ListResponse<HelpArticleSearchResult>> {
    // Stub - in real implementation, would search local article index
    return {
      type: 'list',
      data: [],
      total_count: 0,
      pages: createPages(1, 20, 0),
    }
  }

  /**
   * Get a help center article (local implementation)
   *
   * Note: This is a stub. In a full implementation, this would integrate
   * with the LocalArticlesResource.
   */
  async getArticle(articleId: string): Promise<Article | null> {
    // Stub - in real implementation, would fetch from local article store
    return null
  }

  /**
   * Get help center configuration
   */
  async getHelpCenterConfig(): Promise<HelpCenterConfig> {
    return this.helpCenterConfig
  }

  // ===========================================================================
  // Custom Actions
  // ===========================================================================

  /**
   * Register a custom action with optional handler
   */
  async registerCustomAction(
    actionId: string,
    params: CustomActionParams
  ): Promise<CustomAction> {
    const now = Math.floor(Date.now() / 1000)

    const action: CustomAction = {
      id: actionId,
      label: params.label,
      description: params.description,
      icon: params.icon,
      enabled: true,
      createdAt: now,
    }

    this.customActions.set(actionId, action)

    if (params.handler) {
      this.customActionHandlers.set(actionId, params.handler)
    }

    return action
  }

  /**
   * Trigger a custom action
   */
  async triggerCustomAction(
    actionId: string,
    context: CustomActionContext
  ): Promise<{ triggered: true; actionId: string }> {
    const action = this.customActions.get(actionId)
    if (!action) {
      throw new Error(`Custom action not found: ${actionId}`)
    }

    if (!action.enabled) {
      throw new Error(`Custom action is disabled: ${actionId}`)
    }

    const handler = this.customActionHandlers.get(actionId)
    if (handler) {
      await handler(context)
    }

    return { triggered: true, actionId }
  }

  /**
   * Unregister a custom action
   */
  async unregisterCustomAction(actionId: string): Promise<{ id: string; deleted: true }> {
    if (!this.customActions.has(actionId)) {
      throw new Error(`Custom action not found: ${actionId}`)
    }
    this.customActions.delete(actionId)
    this.customActionHandlers.delete(actionId)
    return { id: actionId, deleted: true }
  }

  /**
   * Get a custom action
   */
  async getCustomAction(actionId: string): Promise<CustomAction | null> {
    return this.customActions.get(actionId) ?? null
  }

  /**
   * List all custom actions
   */
  async listCustomActions(): Promise<CustomAction[]> {
    return Array.from(this.customActions.values())
  }

  // ===========================================================================
  // Identity Verification
  // ===========================================================================

  /**
   * Set identity verification for secure mode
   */
  async setIdentityVerification(
    params: IdentityVerificationParams
  ): Promise<IdentityVerification> {
    const verification: IdentityVerification = {
      userId: params.userId,
      verified: true,
      verifiedAt: Math.floor(Date.now() / 1000),
      email: params.email,
      name: params.name,
    }

    this.identityVerifications.set(params.userId, verification)
    return verification
  }

  /**
   * Verify identity with HMAC
   *
   * Note: This is a simplified implementation. In production, you would
   * validate the HMAC against your secret key.
   */
  async verifyIdentity(hmac: string): Promise<{ verified: boolean; userId?: string }> {
    // In a real implementation, this would verify the HMAC
    // For local implementation, we just check if it looks valid
    if (hmac && hmac.length >= 32) {
      return { verified: true }
    }
    return { verified: false }
  }

  /**
   * Clear identity verification
   */
  async clearIdentity(): Promise<{ cleared: true }> {
    this.identityVerifications.clear()
    return { cleared: true }
  }

  /**
   * Get identity verification for a user
   */
  async getIdentityVerification(userId: string): Promise<IdentityVerification | null> {
    return this.identityVerifications.get(userId) ?? null
  }

  // ===========================================================================
  // Launcher Customization
  // ===========================================================================

  /**
   * Set custom launcher configuration
   */
  async setCustomLauncher(config: CustomLauncherConfig): Promise<CustomLauncherConfig> {
    this.launcherConfig = {
      ...this.launcherConfig,
      ...config,
    }
    return this.launcherConfig
  }

  /**
   * Get custom launcher configuration
   */
  async getCustomLauncher(): Promise<CustomLauncherConfig> {
    return this.launcherConfig
  }

  /**
   * Show the messenger launcher
   */
  async showLauncher(): Promise<{ visible: true }> {
    this.launcherVisible = true
    return { visible: true }
  }

  /**
   * Hide the messenger launcher
   */
  async hideLauncher(): Promise<{ visible: false }> {
    this.launcherVisible = false
    return { visible: false }
  }

  /**
   * Get launcher visibility
   */
  async isLauncherVisible(): Promise<boolean> {
    return this.launcherVisible
  }

  /**
   * Open the messenger
   */
  async openMessenger(options?: MessengerOpenOptions): Promise<{ opened: true }> {
    this.messengerOpen = true
    // In a real implementation, this would trigger UI events
    return { opened: true }
  }

  /**
   * Close the messenger
   */
  async closeMessenger(): Promise<{ closed: true }> {
    this.messengerOpen = false
    return { closed: true }
  }

  /**
   * Check if messenger is open
   */
  async isMessengerOpen(): Promise<boolean> {
    return this.messengerOpen
  }

  // ===========================================================================
  // Message Templates
  // ===========================================================================

  /**
   * Create a message template
   */
  async createMessageTemplate(params: MessageTemplateCreateParams): Promise<MessageTemplate> {
    const id = generateId('template')
    const now = Math.floor(Date.now() / 1000)

    // Extract variables from content
    const variables = this.extractTemplateVariables(params.content)

    const template: MessageTemplate = {
      id,
      name: params.name,
      content: params.content,
      attachments: params.attachments,
      variables,
      createdAt: now,
      updatedAt: now,
    }

    this.messageTemplates.set(id, template)
    return template
  }

  /**
   * List message templates
   */
  async listMessageTemplates(): Promise<ListResponse<MessageTemplate>> {
    const templates = Array.from(this.messageTemplates.values())
    return {
      type: 'list',
      data: templates,
      total_count: templates.length,
      pages: createPages(1, 50, templates.length),
    }
  }

  /**
   * Get a message template
   */
  async getMessageTemplate(templateId: string): Promise<MessageTemplate | null> {
    return this.messageTemplates.get(templateId) ?? null
  }

  /**
   * Delete a message template
   */
  async deleteMessageTemplate(templateId: string): Promise<{ id: string; deleted: true }> {
    if (!this.messageTemplates.has(templateId)) {
      throw new Error(`Template not found: ${templateId}`)
    }
    this.messageTemplates.delete(templateId)
    return { id: templateId, deleted: true }
  }

  /**
   * Send a message from a template
   *
   * Note: This is a stub that returns success. In a real implementation,
   * this would create a message using the template content.
   */
  async sendFromTemplate(
    templateId: string,
    recipientId: string,
    variables?: Record<string, string>
  ): Promise<{ sent: true; messageId: string }> {
    const template = this.messageTemplates.get(templateId)
    if (!template) {
      throw new Error(`Template not found: ${templateId}`)
    }

    // Apply variables to template content
    let content = template.content
    if (variables) {
      for (const [key, value] of Object.entries(variables)) {
        content = content.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), value)
      }
    }

    const messageId = generateId('msg')

    // In a real implementation, this would:
    // 1. Create a message with the processed content
    // 2. Send it to the recipient
    // 3. Return the message ID

    return { sent: true, messageId }
  }

  /**
   * Render a template with variables
   */
  async renderTemplate(
    templateId: string,
    variables?: Record<string, string>
  ): Promise<{ content: string; attachments?: TemplateAttachment[] }> {
    const template = this.messageTemplates.get(templateId)
    if (!template) {
      throw new Error(`Template not found: ${templateId}`)
    }

    let content = template.content
    if (variables) {
      for (const [key, value] of Object.entries(variables)) {
        content = content.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), value)
      }
    }

    return {
      content,
      attachments: template.attachments,
    }
  }

  /**
   * Extract template variables from content
   */
  private extractTemplateVariables(content: string): string[] {
    const matches = content.match(/\{\{([^}]+)\}\}/g) ?? []
    return Array.from(new Set(matches.map((m) => m.slice(2, -2).trim())))
  }
}

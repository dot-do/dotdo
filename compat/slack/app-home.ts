/**
 * @dotdo/slack/app-home - Slack App Home Management
 *
 * Comprehensive App Home management for Slack apps including:
 * - Home tab view publishing
 * - Modal interactions (open, push, update)
 * - Global and message shortcut handling
 * - View submission and close handling
 * - Fluent builders for home tabs and modals
 *
 * @example Basic Home Tab
 * ```typescript
 * import { AppHome, homeTab, section, mrkdwn } from '@dotdo/slack'
 *
 * const appHome = new AppHome({ token: 'xoxb-token' })
 *
 * await appHome.publish({
 *   userId: 'U123',
 *   view: homeTab({
 *     blocks: [
 *       section({ text: mrkdwn('Welcome to your home tab!') }),
 *     ],
 *   }),
 * })
 * ```
 *
 * @example Fluent Builder
 * ```typescript
 * const result = await appHome
 *   .buildHomeTab()
 *   .header('Dashboard')
 *   .section('Welcome, user!')
 *   .divider()
 *   .actions([
 *     button({ text: plainText('Get Started'), action_id: 'start' }),
 *   ])
 *   .publishTo('U123')
 * ```
 *
 * @example Modal from Shortcut
 * ```typescript
 * appHome.onShortcut('create_task', async ({ openModal, triggerId }) => {
 *   await openModal({
 *     title: 'Create Task',
 *     blocks: [
 *       input({
 *         label: plainText('Task Name'),
 *         element: textInput({ action_id: 'task_name' }),
 *       }),
 *     ],
 *     submit: plainText('Create'),
 *   })
 * })
 * ```
 *
 * @see https://api.slack.com/surfaces/app-home
 * @module @dotdo/slack/app-home
 */

import {
  BotWebClient,
  type ViewsPublishArguments,
  type ViewsPublishResponse,
  type ViewsOpenArguments,
  type ViewsOpenResponse,
  type ViewsPushArguments,
  type ViewsPushResponse,
  type ViewsUpdateArguments,
  type ViewsUpdateResponse,
  type ModalView,
  type HomeView,
} from './bot'

import type {
  ViewSubmissionPayload,
  ViewClosedPayload,
  GlobalShortcutPayload,
  MessageShortcutPayload,
  ShortcutPayload,
  ViewOutput,
  ViewState,
  Block,
  EventCallbackBody,
} from './types'

import type { AppHomeOpenedEvent } from './bot'

import {
  type PlainTextObject,
  type TextObject,
  type BlockElement,
  type ImageElement,
  plainText,
  mrkdwn,
  header as headerBlock,
  section as sectionBlock,
  divider as dividerBlock,
  actions as actionsBlock,
  context as contextBlock,
  input as inputBlock,
  image as imageBlock,
  type ImageBlock,
  type PlainTextInputElement,
  type StaticSelectElement,
  type MultiStaticSelectElement,
  type UsersSelectElement,
  type ConversationsSelectElement,
  type ChannelsSelectElement,
  type DatePickerElement,
  type TimePickerElement,
  type CheckboxesElement,
  type RadioButtonsElement,
  textInput,
} from './blocks'

// ============================================================================
// TYPES
// ============================================================================

/**
 * AppHome configuration options
 */
export interface AppHomeConfig {
  /** Bot token (xoxb-*) */
  token?: string
  /** Pre-configured BotWebClient */
  client?: BotWebClient
  /** Custom fetch implementation */
  fetch?: typeof fetch
  /** Default home tab configuration */
  defaultHomeTab?: DefaultHomeTabConfig
}

/**
 * Default home tab configuration
 */
export interface DefaultHomeTabConfig {
  /** Callback ID for the default home tab */
  callbackId?: string
  /** Builder function for default home tab */
  builder: (builder: HomeTabBuilder) => HomeTabBuilder
}

/**
 * Arguments for publishing a home tab
 */
export interface PublishHomeTabArgs {
  /** User ID to publish to */
  userId: string
  /** Home tab view */
  view: HomeTabViewType
  /** Hash for optimistic updates */
  hash?: string
}

/**
 * Arguments for opening a modal
 */
export interface OpenModalArgs {
  /** Trigger ID from interaction */
  triggerId: string
  /** Modal view */
  view: ModalViewType
}

/**
 * Arguments for pushing a modal
 */
export interface PushModalArgs {
  /** Trigger ID from interaction */
  triggerId: string
  /** Modal view */
  view: ModalViewType
}

/**
 * Arguments for updating a modal
 */
export interface UpdateModalArgs {
  /** View ID to update */
  viewId?: string
  /** External ID to update */
  externalId?: string
  /** Hash for optimistic updates */
  hash?: string
  /** Updated modal view */
  view: ModalViewType
}

/**
 * Home tab view type
 */
export interface HomeTabViewType {
  type: 'home'
  blocks: Block[]
  callback_id?: string
  private_metadata?: string
  external_id?: string
}

/**
 * Modal view type
 */
export interface ModalViewType {
  type: 'modal'
  title: PlainTextObject
  blocks: Block[]
  close?: PlainTextObject
  submit?: PlainTextObject
  callback_id?: string
  private_metadata?: string
  clear_on_close?: boolean
  notify_on_close?: boolean
  external_id?: string
}

/**
 * Shortcut handler context
 */
export interface ShortcutContext {
  /** Original payload */
  payload: GlobalShortcutPayload | MessageShortcutPayload
  /** Trigger ID for opening modals */
  triggerId: string
  /** User ID who triggered */
  userId: string
  /** Team ID */
  teamId?: string
  /** Open a modal */
  openModal: (view: Omit<ModalViewType, 'type'>) => Promise<ViewsOpenResponse>
  /** Push a modal */
  pushModal: (view: Omit<ModalViewType, 'type'>) => Promise<ViewsPushResponse>
}

/**
 * Message shortcut context extends ShortcutContext
 */
export interface MessageShortcutContext extends ShortcutContext {
  /** Original message */
  message: {
    type: string
    text: string
    ts: string
    [key: string]: unknown
  }
  /** Channel info */
  channel: { id: string; name?: string }
  /** Respond to the message */
  respond: (message: string | Record<string, unknown>) => Promise<void>
}

/**
 * View submission context
 */
export interface ViewSubmissionContext {
  /** Original view output */
  view: ViewOutput
  /** Form values by block_id and action_id */
  values: ViewState['values']
  /** User who submitted */
  userId: string
  /** Team ID */
  teamId?: string
  /** Private metadata parsed as JSON if valid */
  metadata?: unknown
}

/**
 * View submission response
 */
export interface ViewSubmissionResponse {
  response_action?: 'errors' | 'update' | 'push' | 'clear'
  errors?: Record<string, string>
  view?: ModalViewType
}

/**
 * View closed context
 */
export interface ViewClosedContext {
  /** Original view output */
  view: ViewOutput
  /** Whether the view was cleared programmatically */
  isCleared: boolean
  /** User who closed */
  userId: string
  /** Team ID */
  teamId?: string
}

/**
 * Shortcut handler function type
 */
export type ShortcutHandler = (context: ShortcutContext) => Promise<void>

/**
 * Message shortcut handler function type
 */
export type MessageShortcutHandler = (context: MessageShortcutContext) => Promise<void>

/**
 * View submission handler function type
 */
export type ViewSubmissionHandler = (
  context: ViewSubmissionContext
) => Promise<ViewSubmissionResponse | void>

/**
 * View closed handler function type
 */
export type ViewClosedHandler = (context: ViewClosedContext) => Promise<void>

/**
 * App home opened context
 */
export interface AppHomeOpenedContext {
  /** The app_home_opened event */
  event: AppHomeOpenedEvent
  /** User ID who opened the home tab */
  userId: string
  /** Tab that was opened (home, messages, about) */
  tab: 'home' | 'messages' | 'about'
  /** Previous view if any */
  previousView?: ViewOutput
  /** Publish a home tab view to this user */
  publish: (view: HomeTabViewType | HomeTabBuilder) => Promise<ViewsPublishResponse>
  /** Build a home tab */
  buildHomeTab: () => HomeTabBuilder
  /** The underlying client */
  client: BotWebClient
}

/**
 * App home opened handler function type
 */
export type AppHomeOpenedHandler = (context: AppHomeOpenedContext) => Promise<void>

/**
 * Home tab configuration
 */
export interface HomeTabConfig {
  /** Callback ID */
  callbackId?: string
  /** Private metadata */
  metadata?: unknown
  /** External ID */
  externalId?: string
}

/**
 * Modal configuration
 */
export interface ModalConfig {
  /** Modal title */
  title?: string
  /** Submit button text */
  submit?: string
  /** Close button text */
  close?: string
  /** Callback ID */
  callbackId?: string
  /** Private metadata */
  metadata?: unknown
  /** External ID */
  externalId?: string
  /** Notify on close */
  notifyOnClose?: boolean
  /** Clear on close */
  clearOnClose?: boolean
}

/**
 * Shortcut configuration
 */
export interface ShortcutConfig {
  /** Callback ID pattern */
  callbackId: string | RegExp
  /** Handler function */
  handler: ShortcutHandler | MessageShortcutHandler
}

// ============================================================================
// ERROR CLASS
// ============================================================================

/**
 * App Home specific error
 */
export class AppHomeError extends Error {
  code: string
  data?: unknown

  constructor(code: string, message?: string, data?: unknown) {
    super(message ?? code)
    this.name = 'AppHomeError'
    this.code = code
    this.data = data
  }
}

// ============================================================================
// HOME TAB BUILDER
// ============================================================================

/**
 * Fluent builder for home tab views
 */
export class HomeTabBuilder {
  private _blocks: Block[] = []
  private _callbackId?: string
  private _metadata?: unknown
  private _externalId?: string
  private _appHome: AppHome

  constructor(appHome: AppHome) {
    this._appHome = appHome
  }

  /**
   * Set callback ID
   */
  callbackId(id: string): this {
    this._callbackId = id
    return this
  }

  /**
   * Set private metadata (will be JSON stringified)
   */
  metadata(data: unknown): this {
    this._metadata = data
    return this
  }

  /**
   * Set external ID
   */
  externalId(id: string): this {
    this._externalId = id
    return this
  }

  /**
   * Add a header block
   */
  header(text: string): this {
    this._blocks.push(headerBlock({ text: plainText(text) }))
    return this
  }

  /**
   * Add a section block with mrkdwn text
   */
  section(text: string): this {
    this._blocks.push(sectionBlock({ text: mrkdwn(text) }))
    return this
  }

  /**
   * Add a section block with accessory
   */
  sectionWithAccessory(text: string, accessory: BlockElement): this {
    this._blocks.push(sectionBlock({ text: mrkdwn(text), accessory }))
    return this
  }

  /**
   * Add a section block with fields
   */
  sectionWithFields(fields: string[]): this {
    this._blocks.push(
      sectionBlock({
        fields: fields.map((f) => mrkdwn(f)),
      })
    )
    return this
  }

  /**
   * Add a divider block
   */
  divider(): this {
    this._blocks.push(dividerBlock())
    return this
  }

  /**
   * Add an actions block
   */
  actions(elements: BlockElement[]): this {
    this._blocks.push(actionsBlock({ elements }))
    return this
  }

  /**
   * Add a context block
   */
  context(elements: (TextObject | ImageElement)[]): this {
    this._blocks.push(contextBlock({ elements }))
    return this
  }

  /**
   * Add a context block with simple text elements
   */
  contextText(...texts: string[]): this {
    this._blocks.push(
      contextBlock({
        elements: texts.map((t) => mrkdwn(t)),
      })
    )
    return this
  }

  /**
   * Add an image block
   */
  image(imageUrl: string, altText: string, title?: string): this {
    const block = imageBlock({
      image_url: imageUrl,
      alt_text: altText,
      title: title ? plainText(title) : undefined,
    })
    this._blocks.push(block)
    return this
  }

  /**
   * Add any block
   */
  addBlock(block: Block): this {
    this._blocks.push(block)
    return this
  }

  /**
   * Get the current number of blocks
   */
  get blockCount(): number {
    return this._blocks.length
  }

  /**
   * Build the home tab view
   */
  build(): HomeTabViewType {
    const view: HomeTabViewType = {
      type: 'home',
      blocks: [...this._blocks],
    }

    if (this._callbackId) {
      view.callback_id = this._callbackId
    }

    if (this._metadata !== undefined) {
      view.private_metadata = JSON.stringify(this._metadata)
    }

    if (this._externalId) {
      view.external_id = this._externalId
    }

    return view
  }

  /**
   * Publish the home tab to a user
   */
  async publishTo(userId: string, hash?: string): Promise<ViewsPublishResponse> {
    return this._appHome.publish({
      userId,
      view: this.build(),
      hash,
    })
  }
}

// ============================================================================
// MODAL BUILDER
// ============================================================================

/**
 * Fluent builder for modal views
 */
export class ModalBuilder {
  private _blocks: Block[] = []
  private _title?: string
  private _submit?: string
  private _close?: string
  private _callbackId?: string
  private _metadata?: unknown
  private _externalId?: string
  private _notifyOnClose = false
  private _clearOnClose = false
  private _appHome: AppHome

  constructor(appHome: AppHome) {
    this._appHome = appHome
  }

  /**
   * Set modal title
   */
  title(text: string): this {
    this._title = text
    return this
  }

  /**
   * Set submit button text
   */
  submit(text: string): this {
    this._submit = text
    return this
  }

  /**
   * Set close button text
   */
  close(text: string): this {
    this._close = text
    return this
  }

  /**
   * Set callback ID
   */
  callbackId(id: string): this {
    this._callbackId = id
    return this
  }

  /**
   * Set private metadata (will be JSON stringified)
   */
  metadata(data: unknown): this {
    this._metadata = data
    return this
  }

  /**
   * Set external ID
   */
  externalId(id: string): this {
    this._externalId = id
    return this
  }

  /**
   * Enable notify on close
   */
  notifyOnClose(): this {
    this._notifyOnClose = true
    return this
  }

  /**
   * Enable clear on close
   */
  clearOnClose(): this {
    this._clearOnClose = true
    return this
  }

  /**
   * Add a header block
   */
  header(text: string): this {
    this._blocks.push(headerBlock({ text: plainText(text) }))
    return this
  }

  /**
   * Add a section block with mrkdwn text
   */
  section(text: string): this {
    this._blocks.push(sectionBlock({ text: mrkdwn(text) }))
    return this
  }

  /**
   * Add a divider block
   */
  divider(): this {
    this._blocks.push(dividerBlock())
    return this
  }

  /**
   * Add an input block
   */
  input(config: {
    blockId: string
    label: string
    actionId: string
    placeholder?: string
    optional?: boolean
    multiline?: boolean
  }): this {
    this._blocks.push(
      inputBlock({
        block_id: config.blockId,
        label: plainText(config.label),
        element: textInput({
          action_id: config.actionId,
          placeholder: config.placeholder ? plainText(config.placeholder) : undefined,
          multiline: config.multiline,
        }),
        optional: config.optional,
      })
    )
    return this
  }

  /**
   * Add an input block with custom element
   */
  inputWithElement(config: {
    blockId: string
    label: string
    element:
      | PlainTextInputElement
      | StaticSelectElement
      | MultiStaticSelectElement
      | UsersSelectElement
      | ConversationsSelectElement
      | ChannelsSelectElement
      | DatePickerElement
      | TimePickerElement
      | CheckboxesElement
      | RadioButtonsElement
    hint?: string
    optional?: boolean
  }): this {
    this._blocks.push(
      inputBlock({
        block_id: config.blockId,
        label: plainText(config.label),
        element: config.element,
        hint: config.hint ? plainText(config.hint) : undefined,
        optional: config.optional,
      })
    )
    return this
  }

  /**
   * Add an actions block
   */
  actions(elements: BlockElement[]): this {
    this._blocks.push(actionsBlock({ elements }))
    return this
  }

  /**
   * Add a context block
   */
  context(elements: (TextObject | ImageElement)[]): this {
    this._blocks.push(contextBlock({ elements }))
    return this
  }

  /**
   * Add a context block with simple text elements
   */
  contextText(...texts: string[]): this {
    this._blocks.push(
      contextBlock({
        elements: texts.map((t) => mrkdwn(t)),
      })
    )
    return this
  }

  /**
   * Add an image block
   */
  image(imageUrl: string, altText: string, title?: string): this {
    const block = imageBlock({
      image_url: imageUrl,
      alt_text: altText,
      title: title ? plainText(title) : undefined,
    })
    this._blocks.push(block)
    return this
  }

  /**
   * Add any block
   */
  addBlock(block: Block): this {
    this._blocks.push(block)
    return this
  }

  /**
   * Get the current number of blocks
   */
  get blockCount(): number {
    return this._blocks.length
  }

  /**
   * Build the modal view
   */
  build(): ModalViewType {
    if (!this._title) {
      throw new AppHomeError('missing_title', 'Modal title is required')
    }

    const view: ModalViewType = {
      type: 'modal',
      title: plainText(this._title),
      blocks: [...this._blocks],
    }

    if (this._submit) {
      view.submit = plainText(this._submit)
    }

    if (this._close) {
      view.close = plainText(this._close)
    }

    if (this._callbackId) {
      view.callback_id = this._callbackId
    }

    if (this._metadata !== undefined) {
      view.private_metadata = JSON.stringify(this._metadata)
    }

    if (this._externalId) {
      view.external_id = this._externalId
    }

    if (this._notifyOnClose) {
      view.notify_on_close = true
    }

    if (this._clearOnClose) {
      view.clear_on_close = true
    }

    return view
  }

  /**
   * Open the modal with a trigger ID
   */
  async openWith(triggerId: string): Promise<ViewsOpenResponse> {
    return this._appHome.openModal({
      triggerId,
      view: this.build(),
    })
  }

  /**
   * Push the modal with a trigger ID
   */
  async pushWith(triggerId: string): Promise<ViewsPushResponse> {
    return this._appHome.pushModal({
      triggerId,
      view: this.build(),
    })
  }
}

// ============================================================================
// APP HOME CLASS
// ============================================================================

/**
 * Main App Home management class
 */
export class AppHome {
  private client: BotWebClient
  private _fetch: typeof fetch
  private defaultHomeTab?: DefaultHomeTabConfig

  private shortcutHandlers: Map<string | RegExp, ShortcutHandler> = new Map()
  private messageShortcutHandlers: Map<string | RegExp, MessageShortcutHandler> = new Map()
  private viewSubmissionHandlers: Map<string | RegExp, ViewSubmissionHandler> = new Map()
  private viewClosedHandlers: Map<string | RegExp, ViewClosedHandler> = new Map()
  private appHomeOpenedHandler?: AppHomeOpenedHandler

  constructor(config: AppHomeConfig) {
    if (!config.token && !config.client) {
      throw new AppHomeError('missing_config', 'Either token or client is required')
    }

    if (config.client) {
      this.client = config.client
    } else {
      this.client = new BotWebClient(config.token, { fetch: config.fetch })
    }

    this._fetch = config.fetch ?? globalThis.fetch
    this.defaultHomeTab = config.defaultHomeTab
  }

  /**
   * Get the underlying client
   */
  getClient(): BotWebClient {
    return this.client
  }

  // ==========================================================================
  // HOME TAB METHODS
  // ==========================================================================

  /**
   * Publish a home tab view
   */
  async publish(args: PublishHomeTabArgs): Promise<ViewsPublishResponse> {
    const apiArgs: ViewsPublishArguments = {
      user_id: args.userId,
      view: args.view as HomeView,
    }

    if (args.hash) {
      apiArgs.hash = args.hash
    }

    try {
      const result = await this.client.views.publish(apiArgs)

      if (!result.ok) {
        throw new AppHomeError(result.error ?? 'unknown_error', 'Failed to publish home tab', result)
      }

      return result
    } catch (error) {
      if (error instanceof AppHomeError) {
        throw error
      }
      // Wrap SlackError or other errors in AppHomeError
      const slackError = error as { code?: string; data?: unknown; message?: string }
      throw new AppHomeError(
        slackError.code ?? 'unknown_error',
        slackError.message ?? 'Failed to publish home tab',
        slackError.data
      )
    }
  }

  /**
   * Publish default home tab (if configured)
   */
  async publishDefault(userId: string): Promise<ViewsPublishResponse> {
    if (!this.defaultHomeTab) {
      throw new AppHomeError('no_default', 'No default home tab configured')
    }

    const builder = this.defaultHomeTab.builder(this.buildHomeTab())

    if (this.defaultHomeTab.callbackId) {
      builder.callbackId(this.defaultHomeTab.callbackId)
    }

    return this.publish({
      userId,
      view: builder.build(),
    })
  }

  /**
   * Create a home tab builder
   */
  buildHomeTab(): HomeTabBuilder {
    return new HomeTabBuilder(this)
  }

  // ==========================================================================
  // APP HOME OPENED EVENT HANDLING
  // ==========================================================================

  /**
   * Register a handler for app_home_opened events.
   * This allows you to publish a customized home tab when users open your app.
   *
   * @example
   * ```typescript
   * appHome.onAppHomeOpened(async ({ userId, tab, publish, buildHomeTab }) => {
   *   if (tab === 'home') {
   *     await publish(
   *       buildHomeTab()
   *         .header('Welcome!')
   *         .section(`Hello <@${userId}>`)
   *     )
   *   }
   * })
   * ```
   */
  onAppHomeOpened(handler: AppHomeOpenedHandler): this {
    this.appHomeOpenedHandler = handler
    return this
  }

  /**
   * Check if app_home_opened handler exists
   */
  hasAppHomeOpenedHandler(): boolean {
    return this.appHomeOpenedHandler !== undefined
  }

  /**
   * Handle an app_home_opened event.
   * Call this from your SlackBot event handler or directly with the event data.
   *
   * @example Integration with SlackBot
   * ```typescript
   * bot.event('app_home_opened', async ({ event }) => {
   *   await appHome.handleAppHomeOpened(event)
   * })
   * ```
   */
  async handleAppHomeOpened(event: AppHomeOpenedEvent): Promise<void> {
    if (!this.appHomeOpenedHandler) {
      // If no handler but defaultHomeTab is configured, publish that
      if (this.defaultHomeTab && event.tab === 'home') {
        await this.publishDefault(event.user)
      }
      return
    }

    const context: AppHomeOpenedContext = {
      event,
      userId: event.user,
      tab: event.tab,
      previousView: event.view,
      publish: async (view) => {
        if (view instanceof HomeTabBuilder) {
          return this.publish({ userId: event.user, view: view.build() })
        }
        return this.publish({ userId: event.user, view })
      },
      buildHomeTab: () => this.buildHomeTab(),
      client: this.client,
    }

    await this.appHomeOpenedHandler(context)
  }

  /**
   * Handle an event callback body that might contain app_home_opened.
   * This is useful for processing raw event payloads from Slack.
   */
  async handleEventCallback(body: EventCallbackBody): Promise<boolean> {
    if (body.event?.type === 'app_home_opened') {
      await this.handleAppHomeOpened(body.event as AppHomeOpenedEvent)
      return true
    }
    return false
  }

  // ==========================================================================
  // MODAL METHODS
  // ==========================================================================

  /**
   * Open a modal
   */
  async openModal(args: OpenModalArgs): Promise<ViewsOpenResponse> {
    try {
      const result = await this.client.views.open({
        trigger_id: args.triggerId,
        view: args.view as ModalView,
      })

      if (!result.ok) {
        throw new AppHomeError(result.error ?? 'unknown_error', 'Failed to open modal', result)
      }

      return result
    } catch (error) {
      if (error instanceof AppHomeError) {
        throw error
      }
      const slackError = error as { code?: string; data?: unknown; message?: string }
      throw new AppHomeError(
        slackError.code ?? 'unknown_error',
        slackError.message ?? 'Failed to open modal',
        slackError.data
      )
    }
  }

  /**
   * Push a modal onto the stack
   */
  async pushModal(args: PushModalArgs): Promise<ViewsPushResponse> {
    try {
      const result = await this.client.views.push({
        trigger_id: args.triggerId,
        view: args.view as ModalView,
      })

      if (!result.ok) {
        throw new AppHomeError(result.error ?? 'unknown_error', 'Failed to push modal', result)
      }

      return result
    } catch (error) {
      if (error instanceof AppHomeError) {
        throw error
      }
      const slackError = error as { code?: string; data?: unknown; message?: string }
      throw new AppHomeError(
        slackError.code ?? 'unknown_error',
        slackError.message ?? 'Failed to push modal',
        slackError.data
      )
    }
  }

  /**
   * Update an existing modal
   */
  async updateModal(args: UpdateModalArgs): Promise<ViewsUpdateResponse> {
    if (!args.viewId && !args.externalId) {
      throw new AppHomeError('missing_id', 'Either viewId or externalId is required')
    }

    const apiArgs: ViewsUpdateArguments = {
      view: args.view as ModalView,
    }

    if (args.viewId) {
      apiArgs.view_id = args.viewId
    }

    if (args.externalId) {
      apiArgs.external_id = args.externalId
    }

    if (args.hash) {
      apiArgs.hash = args.hash
    }

    try {
      const result = await this.client.views.update(apiArgs)

      if (!result.ok) {
        throw new AppHomeError(result.error ?? 'unknown_error', 'Failed to update modal', result)
      }

      return result
    } catch (error) {
      if (error instanceof AppHomeError) {
        throw error
      }
      const slackError = error as { code?: string; data?: unknown; message?: string }
      throw new AppHomeError(
        slackError.code ?? 'unknown_error',
        slackError.message ?? 'Failed to update modal',
        slackError.data
      )
    }
  }

  /**
   * Create a modal builder
   */
  buildModal(): ModalBuilder {
    return new ModalBuilder(this)
  }

  // ==========================================================================
  // SHORTCUT HANDLERS
  // ==========================================================================

  /**
   * Register a global shortcut handler
   */
  onShortcut(callbackId: string | RegExp, handler: ShortcutHandler): this {
    this.shortcutHandlers.set(callbackId, handler)
    return this
  }

  /**
   * Register a message shortcut handler
   */
  onMessageShortcut(callbackId: string | RegExp, handler: MessageShortcutHandler): this {
    this.messageShortcutHandlers.set(callbackId, handler)
    return this
  }

  /**
   * Check if shortcut handler exists
   */
  hasShortcutHandler(callbackId: string): boolean {
    return this.findHandler(callbackId, this.shortcutHandlers) !== undefined
  }

  /**
   * Check if message shortcut handler exists
   */
  hasMessageShortcutHandler(callbackId: string): boolean {
    return this.findHandler(callbackId, this.messageShortcutHandlers) !== undefined
  }

  /**
   * Handle a shortcut payload
   */
  async handleShortcut(payload: ShortcutPayload): Promise<void> {
    const isMessageShortcut = payload.type === 'message_action'

    // Find handler
    let handler: ShortcutHandler | MessageShortcutHandler | undefined

    if (isMessageShortcut) {
      handler = this.findHandler(payload.callback_id, this.messageShortcutHandlers)
    }

    if (!handler) {
      handler = this.findHandler(payload.callback_id, this.shortcutHandlers)
    }

    if (!handler) {
      // No handler found - just return silently
      return
    }

    // Create context
    const baseContext: ShortcutContext = {
      payload,
      triggerId: payload.trigger_id,
      userId: payload.user.id,
      teamId: payload.team?.id,
      openModal: async (view) => {
        return this.openModal({
          triggerId: payload.trigger_id,
          view: { type: 'modal', ...view },
        })
      },
      pushModal: async (view) => {
        return this.pushModal({
          triggerId: payload.trigger_id,
          view: { type: 'modal', ...view },
        })
      },
    }

    if (isMessageShortcut) {
      const msgPayload = payload as MessageShortcutPayload
      const msgContext: MessageShortcutContext = {
        ...baseContext,
        message: msgPayload.message,
        channel: msgPayload.channel,
        respond: async (message) => {
          if (msgPayload.response_url) {
            const body = typeof message === 'string' ? { text: message } : message
            await this._fetch(msgPayload.response_url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            })
          }
        },
      }
      await (handler as MessageShortcutHandler)(msgContext)
    } else {
      await (handler as ShortcutHandler)(baseContext)
    }
  }

  // ==========================================================================
  // VIEW SUBMISSION HANDLERS
  // ==========================================================================

  /**
   * Register a view submission handler
   */
  onViewSubmission(callbackId: string | RegExp, handler: ViewSubmissionHandler): this {
    this.viewSubmissionHandlers.set(callbackId, handler)
    return this
  }

  /**
   * Check if view submission handler exists
   */
  hasViewSubmissionHandler(callbackId: string): boolean {
    return this.findHandler(callbackId, this.viewSubmissionHandlers) !== undefined
  }

  /**
   * Handle a view submission payload
   */
  async handleViewSubmission(
    payload: ViewSubmissionPayload
  ): Promise<ViewSubmissionResponse | undefined> {
    const callbackId = payload.view.callback_id

    if (!callbackId) {
      return undefined
    }

    const handler = this.findHandler(callbackId, this.viewSubmissionHandlers)

    if (!handler) {
      return undefined
    }

    // Parse metadata
    let metadata: unknown
    if (payload.view.private_metadata) {
      try {
        metadata = JSON.parse(payload.view.private_metadata)
      } catch {
        metadata = payload.view.private_metadata
      }
    }

    const context: ViewSubmissionContext = {
      view: payload.view,
      values: payload.view.state?.values ?? {},
      userId: payload.user.id,
      teamId: payload.team?.id,
      metadata,
    }

    return handler(context)
  }

  // ==========================================================================
  // VIEW CLOSED HANDLERS
  // ==========================================================================

  /**
   * Register a view closed handler
   */
  onViewClosed(callbackId: string | RegExp, handler: ViewClosedHandler): this {
    this.viewClosedHandlers.set(callbackId, handler)
    return this
  }

  /**
   * Check if view closed handler exists
   */
  hasViewClosedHandler(callbackId: string): boolean {
    return this.findHandler(callbackId, this.viewClosedHandlers) !== undefined
  }

  /**
   * Handle a view closed payload
   */
  async handleViewClosed(payload: ViewClosedPayload): Promise<void> {
    const callbackId = payload.view.callback_id

    if (!callbackId) {
      return
    }

    const handler = this.findHandler(callbackId, this.viewClosedHandlers)

    if (!handler) {
      return
    }

    const context: ViewClosedContext = {
      view: payload.view,
      isCleared: payload.is_cleared,
      userId: payload.user.id,
      teamId: payload.team?.id,
    }

    await handler(context)
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  private findHandler<T>(
    callbackId: string,
    handlers: Map<string | RegExp, T>
  ): T | undefined {
    // Try exact match first
    if (handlers.has(callbackId)) {
      return handlers.get(callbackId)
    }

    // Try regex patterns
    for (const [pattern, handler] of handlers) {
      if (pattern instanceof RegExp && pattern.test(callbackId)) {
        return handler
      }
    }

    return undefined
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create an AppHome instance
 */
export function createAppHome(config: AppHomeConfig): AppHome {
  return new AppHome(config)
}

// ============================================================================
// RE-EXPORTS FOR CONVENIENCE
// ============================================================================

export { homeTab, modal } from './blocks'
export type { HomeTabView, ModalView as ModalViewExport } from './blocks'

/**
 * Context for home tab rendering
 */
export interface HomeTabContext {
  /** User ID viewing the home tab */
  userId: string
  /** Team ID */
  teamId?: string
  /** Previous view if any */
  previousView?: ViewOutput
  /** Event timestamp */
  eventTs: string
}

// ============================================================================
// VALUE EXTRACTION UTILITIES
// ============================================================================

/**
 * Extract a text input value from view state values.
 * Returns the value or undefined if not found.
 *
 * @example
 * ```typescript
 * appHome.onViewSubmission('feedback_form', async ({ values }) => {
 *   const feedback = extractTextValue(values, 'feedback_block', 'feedback_input')
 *   // feedback is string | undefined
 * })
 * ```
 */
export function extractTextValue(
  values: ViewState['values'],
  blockId: string,
  actionId: string
): string | undefined {
  return values[blockId]?.[actionId]?.value
}

/**
 * Extract a selected option value from view state values (static_select).
 * Returns the option value or undefined if not found.
 */
export function extractSelectValue(
  values: ViewState['values'],
  blockId: string,
  actionId: string
): string | undefined {
  return values[blockId]?.[actionId]?.selected_option?.value
}

/**
 * Extract multiple selected option values from view state (multi_static_select).
 * Returns an array of values or undefined if not found.
 */
export function extractMultiSelectValues(
  values: ViewState['values'],
  blockId: string,
  actionId: string
): string[] | undefined {
  const options = values[blockId]?.[actionId]?.selected_options
  return options?.map((o) => o.value)
}

/**
 * Extract a selected user ID from view state (users_select).
 */
export function extractUserValue(
  values: ViewState['values'],
  blockId: string,
  actionId: string
): string | undefined {
  return values[blockId]?.[actionId]?.selected_user
}

/**
 * Extract multiple selected user IDs from view state (multi_users_select).
 */
export function extractMultiUserValues(
  values: ViewState['values'],
  blockId: string,
  actionId: string
): string[] | undefined {
  return values[blockId]?.[actionId]?.selected_users
}

/**
 * Extract a selected channel ID from view state (channels_select).
 */
export function extractChannelValue(
  values: ViewState['values'],
  blockId: string,
  actionId: string
): string | undefined {
  return values[blockId]?.[actionId]?.selected_channel
}

/**
 * Extract multiple selected channel IDs from view state (multi_channels_select).
 */
export function extractMultiChannelValues(
  values: ViewState['values'],
  blockId: string,
  actionId: string
): string[] | undefined {
  return values[blockId]?.[actionId]?.selected_channels
}

/**
 * Extract a selected conversation ID from view state (conversations_select).
 */
export function extractConversationValue(
  values: ViewState['values'],
  blockId: string,
  actionId: string
): string | undefined {
  return values[blockId]?.[actionId]?.selected_conversation
}

/**
 * Extract a selected date from view state (datepicker).
 * Returns date string in YYYY-MM-DD format or undefined.
 */
export function extractDateValue(
  values: ViewState['values'],
  blockId: string,
  actionId: string
): string | undefined {
  return values[blockId]?.[actionId]?.selected_date
}

/**
 * Extract a selected time from view state (timepicker).
 * Returns time string in HH:MM format or undefined.
 */
export function extractTimeValue(
  values: ViewState['values'],
  blockId: string,
  actionId: string
): string | undefined {
  return values[blockId]?.[actionId]?.selected_time
}

/**
 * Extract all values from a view submission as a flat object.
 * Useful for simple forms where block_id matches the desired key.
 *
 * @example
 * ```typescript
 * const data = extractAllValues(values)
 * // { name_block: 'John', email_block: 'john@example.com' }
 * ```
 */
export function extractAllValues(
  values: ViewState['values']
): Record<string, string | string[] | undefined> {
  const result: Record<string, string | string[] | undefined> = {}

  for (const [blockId, actions] of Object.entries(values)) {
    for (const [, stateValue] of Object.entries(actions)) {
      // Handle different input types
      if (stateValue.value !== undefined) {
        result[blockId] = stateValue.value
      } else if (stateValue.selected_option) {
        result[blockId] = stateValue.selected_option.value
      } else if (stateValue.selected_options) {
        result[blockId] = stateValue.selected_options.map((o) => o.value)
      } else if (stateValue.selected_user) {
        result[blockId] = stateValue.selected_user
      } else if (stateValue.selected_users) {
        result[blockId] = stateValue.selected_users
      } else if (stateValue.selected_channel) {
        result[blockId] = stateValue.selected_channel
      } else if (stateValue.selected_channels) {
        result[blockId] = stateValue.selected_channels
      } else if (stateValue.selected_conversation) {
        result[blockId] = stateValue.selected_conversation
      } else if (stateValue.selected_conversations) {
        result[blockId] = stateValue.selected_conversations
      } else if (stateValue.selected_date) {
        result[blockId] = stateValue.selected_date
      } else if (stateValue.selected_time) {
        result[blockId] = stateValue.selected_time
      }
    }
  }

  return result
}

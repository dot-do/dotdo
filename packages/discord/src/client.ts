/**
 * @dotdo/discord - Client
 *
 * Discord bot client with gateway event handling
 *
 * @example
 * ```typescript
 * import { Client, GatewayIntentBits } from '@dotdo/discord'
 *
 * const client = new Client({
 *   intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
 * })
 *
 * client.on('ready', () => {
 *   console.log(`Logged in as ${client.user.tag}`)
 * })
 *
 * client.on('messageCreate', async (message) => {
 *   if (message.content === '!ping') {
 *     await message.reply('Pong!')
 *   }
 * })
 *
 * await client.login('bot-token')
 * ```
 */

import {
  type ClientOptions,
  type User,
  type Message,
  type Interaction,
  type Guild,
  type Channel,
  type GuildMember,
  type InteractionType,
} from './types'
import { REST, Routes, DiscordError } from './rest'

// ============================================================================
// EVENT TYPES
// ============================================================================

type ClientEvents = {
  ready: [client: Client]
  messageCreate: [message: ClientMessage]
  messageUpdate: [oldMessage: ClientMessage | null, newMessage: ClientMessage]
  messageDelete: [message: ClientMessage | Partial<ClientMessage>]
  interactionCreate: [interaction: ClientInteraction]
  guildCreate: [guild: ClientGuild]
  guildDelete: [guild: ClientGuild]
  guildMemberAdd: [member: ClientGuildMember]
  guildMemberRemove: [member: ClientGuildMember | Partial<ClientGuildMember>]
  error: [error: Error]
  warn: [message: string]
  debug: [message: string]
}

type EventHandler<K extends keyof ClientEvents> = (...args: ClientEvents[K]) => void | Promise<void>

// ============================================================================
// CLIENT USER
// ============================================================================

/**
 * Represents the logged-in bot user
 */
export class ClientUser {
  id: string
  username: string
  discriminator: string
  globalName: string | null
  avatar: string | null
  bot: boolean

  constructor(data: User) {
    this.id = data.id
    this.username = data.username
    this.discriminator = data.discriminator
    this.globalName = data.global_name ?? null
    this.avatar = data.avatar
    this.bot = data.bot ?? false
  }

  /**
   * Get the user's tag (username#discriminator)
   */
  get tag(): string {
    return `${this.username}#${this.discriminator}`
  }

  /**
   * Get the user's display name
   */
  get displayName(): string {
    return this.globalName ?? this.username
  }
}

// ============================================================================
// CLIENT MESSAGE
// ============================================================================

/**
 * Represents a Discord message with helper methods
 */
export class ClientMessage implements Message {
  // Raw message properties
  id: string
  channel_id: string
  author: User
  content: string
  timestamp: string
  edited_timestamp: string | null
  tts: boolean
  mention_everyone: boolean
  mentions: User[]
  mention_roles: string[]
  attachments: Message['attachments']
  embeds: Message['embeds']
  pinned: boolean
  type: number

  private _client: Client
  private _rest: REST

  constructor(data: Partial<Message>, client: Client, rest: REST) {
    this.id = data.id ?? ''
    this.channel_id = data.channel_id ?? ''
    this.author = data.author ?? { id: '', username: '', discriminator: '', avatar: null }
    this.content = data.content ?? ''
    this.timestamp = data.timestamp ?? new Date().toISOString()
    this.edited_timestamp = data.edited_timestamp ?? null
    this.tts = data.tts ?? false
    this.mention_everyone = data.mention_everyone ?? false
    this.mentions = data.mentions ?? []
    this.mention_roles = data.mention_roles ?? []
    this.attachments = data.attachments ?? []
    this.embeds = data.embeds ?? []
    this.pinned = data.pinned ?? false
    this.type = data.type ?? 0
    this._client = client
    this._rest = rest
  }

  /**
   * Reply to this message
   */
  async reply(content: string | { content?: string; embeds?: unknown[]; components?: unknown[] }): Promise<ClientMessage> {
    const body = typeof content === 'string' ? { content } : content
    const data = await this._rest.post(Routes.channelMessages(this.channel_id), {
      body: {
        ...body,
        message_reference: { message_id: this.id },
      },
    }) as Message
    return new ClientMessage(data, this._client, this._rest)
  }

  /**
   * Edit this message (only works for bot's own messages)
   */
  async edit(content: string | { content?: string; embeds?: unknown[]; components?: unknown[] }): Promise<ClientMessage> {
    const body = typeof content === 'string' ? { content } : content
    const data = await this._rest.patch(Routes.channelMessage(this.channel_id, this.id), {
      body,
    }) as Message
    return new ClientMessage(data, this._client, this._rest)
  }

  /**
   * Delete this message
   */
  async delete(): Promise<void> {
    await this._rest.delete(Routes.channelMessage(this.channel_id, this.id))
  }

  /**
   * React to this message
   */
  async react(emoji: string): Promise<void> {
    await this._rest.put(Routes.channelMessageReaction(this.channel_id, this.id, emoji))
  }
}

// ============================================================================
// CLIENT INTERACTION
// ============================================================================

/**
 * Represents a Discord interaction with helper methods
 */
export class ClientInteraction implements Interaction {
  id: string
  application_id: string
  type: InteractionType
  data?: Interaction['data']
  guild_id?: string
  channel_id?: string
  member?: GuildMember
  user?: User
  token: string
  version: number
  message?: Message

  private _client: Client
  private _rest: REST
  private _replied = false
  private _deferred = false

  constructor(data: Partial<Interaction>, client: Client, rest: REST) {
    this.id = data.id ?? ''
    this.application_id = data.application_id ?? ''
    this.type = data.type ?? 1 // Default to Ping
    this.data = data.data
    this.guild_id = data.guild_id
    this.channel_id = data.channel_id
    this.member = data.member
    this.user = data.user ?? data.member?.user
    this.token = data.token ?? ''
    this.version = data.version ?? 1
    this.message = data.message
    this._client = client
    this._rest = rest
  }

  /**
   * Get the command name (for chat input commands)
   */
  get commandName(): string | undefined {
    return this.data?.name
  }

  /**
   * Check if this is a chat input command
   */
  isChatInputCommand(): boolean {
    return this.type === 2 && this.data?.type === undefined
  }

  /**
   * Check if this is a button interaction
   */
  isButton(): boolean {
    return this.type === 3 && this.data?.component_type === 2
  }

  /**
   * Check if this is a select menu interaction
   */
  isStringSelectMenu(): boolean {
    return this.type === 3 && this.data?.component_type === 3
  }

  /**
   * Check if this is a modal submit
   */
  isModalSubmit(): boolean {
    return this.type === 5
  }

  /**
   * Reply to the interaction
   */
  async reply(content: string | { content?: string; embeds?: unknown[]; components?: unknown[]; ephemeral?: boolean }): Promise<void> {
    const body = typeof content === 'string' ? { content } : content
    const flags = body.ephemeral ? 64 : 0

    await this._rest.post(Routes.interactionCallback(this.id, this.token), {
      body: {
        type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
        data: {
          ...body,
          flags: flags || undefined,
        },
      },
    })
    this._replied = true
  }

  /**
   * Defer the reply (show "Bot is thinking...")
   */
  async deferReply(options?: { ephemeral?: boolean }): Promise<void> {
    await this._rest.post(Routes.interactionCallback(this.id, this.token), {
      body: {
        type: 5, // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
        data: {
          flags: options?.ephemeral ? 64 : undefined,
        },
      },
    })
    this._deferred = true
  }

  /**
   * Edit the original reply
   */
  async editReply(content: string | { content?: string; embeds?: unknown[]; components?: unknown[] }): Promise<void> {
    const body = typeof content === 'string' ? { content } : content
    await this._rest.patch(Routes.webhookMessage(this.application_id, this.token, '@original'), {
      body,
    })
  }

  /**
   * Delete the original reply
   */
  async deleteReply(): Promise<void> {
    await this._rest.delete(Routes.webhookMessage(this.application_id, this.token, '@original'))
  }

  /**
   * Follow up with another message
   */
  async followUp(content: string | { content?: string; embeds?: unknown[]; components?: unknown[]; ephemeral?: boolean }): Promise<void> {
    const body = typeof content === 'string' ? { content } : content
    const flags = (body as any).ephemeral ? 64 : 0

    await this._rest.post(Routes.webhookWithToken(this.application_id, this.token), {
      body: {
        ...body,
        flags: flags || undefined,
      },
    })
  }

  /**
   * Show a modal
   */
  async showModal(modal: { custom_id?: string; title?: string; components: unknown[] }): Promise<void> {
    await this._rest.post(Routes.interactionCallback(this.id, this.token), {
      body: {
        type: 9, // MODAL
        data: modal,
      },
    })
  }

  /**
   * Get an option value
   */
  getOption<T = string | number | boolean>(name: string): T | undefined {
    return this.data?.options?.find(o => o.name === name)?.value as T | undefined
  }
}

// ============================================================================
// CLIENT GUILD
// ============================================================================

/**
 * Represents a Discord guild
 */
export class ClientGuild implements Partial<Guild> {
  id: string
  name: string
  icon: string | null
  owner_id: string
  member_count?: number

  constructor(data: Partial<Guild>) {
    this.id = data.id ?? ''
    this.name = data.name ?? ''
    this.icon = data.icon ?? null
    this.owner_id = data.owner_id ?? ''
    this.member_count = data.member_count
  }
}

// ============================================================================
// CLIENT GUILD MEMBER
// ============================================================================

/**
 * Represents a Discord guild member
 */
export class ClientGuildMember implements Partial<GuildMember> {
  user: User
  nick?: string | null
  roles: string[]
  joined_at: string
  deaf: boolean
  mute: boolean

  constructor(data: Partial<GuildMember>) {
    this.user = data.user ?? { id: '', username: '', discriminator: '', avatar: null }
    this.nick = data.nick
    this.roles = data.roles ?? []
    this.joined_at = data.joined_at ?? ''
    this.deaf = data.deaf ?? false
    this.mute = data.mute ?? false
  }
}

// ============================================================================
// CLIENT
// ============================================================================

/**
 * Discord bot client
 */
export class Client {
  private _token?: string
  private _user: ClientUser | null = null
  private _intents: number
  private _rest: REST
  private _listeners: Map<string, Set<EventHandler<any>>> = new Map()

  constructor(options: ClientOptions) {
    // Calculate intents
    if (Array.isArray(options.intents)) {
      this._intents = options.intents.reduce((acc, intent) => acc | intent, 0)
    } else {
      this._intents = options.intents
    }

    this._rest = new REST(options.rest)
  }

  /**
   * Get the logged-in user
   */
  get user(): ClientUser | null {
    return this._user
  }

  /**
   * Get the REST client
   */
  get rest(): REST {
    return this._rest
  }

  /**
   * Login to Discord
   */
  async login(token: string): Promise<void> {
    this._token = token
    this._rest.setToken(token)

    try {
      // Fetch bot user info
      const userData = await this._rest.get(Routes.userMe()) as User
      this._user = new ClientUser(userData)

      // Emit ready event
      this.emit('ready', this)
    } catch (error) {
      this._user = null
      throw error
    }
  }

  /**
   * Destroy the client and clear state
   */
  destroy(): void {
    this._user = null
    this._token = undefined
    this._listeners.clear()
  }

  /**
   * Add an event listener
   */
  on<K extends keyof ClientEvents>(event: K, handler: EventHandler<K>): this {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set())
    }
    this._listeners.get(event)!.add(handler)
    return this
  }

  /**
   * Add a one-time event listener
   */
  once<K extends keyof ClientEvents>(event: K, handler: EventHandler<K>): this {
    const onceHandler: EventHandler<K> = (...args) => {
      this.off(event, onceHandler)
      return handler(...args)
    }
    return this.on(event, onceHandler)
  }

  /**
   * Remove an event listener
   */
  off<K extends keyof ClientEvents>(event: K, handler: EventHandler<K>): this {
    this._listeners.get(event)?.delete(handler)
    return this
  }

  /**
   * Emit an event
   */
  emit<K extends keyof ClientEvents>(event: K, ...args: ClientEvents[K]): boolean {
    const handlers = this._listeners.get(event)
    if (!handlers || handlers.size === 0) {
      return false
    }

    for (const handler of handlers) {
      try {
        handler(...args)
      } catch (error) {
        // Emit error for uncaught handler errors
        if (event !== 'error') {
          this.emit('error', error as Error)
        }
      }
    }
    return true
  }

  /**
   * Handle a gateway event (internal method for testing/webhook handling)
   * @internal
   */
  _handleGatewayEvent(eventType: string, data: unknown): void {
    switch (eventType) {
      case 'MESSAGE_CREATE':
        this.emit('messageCreate', new ClientMessage(data as Message, this, this._rest))
        break

      case 'MESSAGE_UPDATE':
        this.emit('messageUpdate', null, new ClientMessage(data as Message, this, this._rest))
        break

      case 'MESSAGE_DELETE':
        this.emit('messageDelete', data as ClientMessage)
        break

      case 'INTERACTION_CREATE':
        this.emit('interactionCreate', new ClientInteraction(data as Interaction, this, this._rest))
        break

      case 'GUILD_CREATE':
        this.emit('guildCreate', new ClientGuild(data as Guild))
        break

      case 'GUILD_DELETE':
        this.emit('guildDelete', new ClientGuild(data as Guild))
        break

      case 'GUILD_MEMBER_ADD':
        this.emit('guildMemberAdd', new ClientGuildMember(data as GuildMember))
        break

      case 'GUILD_MEMBER_REMOVE':
        this.emit('guildMemberRemove', data as ClientGuildMember)
        break
    }
  }
}

export { DiscordError }

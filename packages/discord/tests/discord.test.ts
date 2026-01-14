/**
 * @dotdo/discord - Discord SDK Compat Layer Tests
 *
 * Comprehensive tests for Discord API compatibility:
 * - Client creation and gateway events
 * - REST API for slash commands
 * - Messages: send, edit, delete, react, threads
 * - Channels: create, edit, delete, permissions
 * - Guilds: info, roles, members
 * - Interactions: slash commands, buttons, modals
 * - Webhooks: create, execute, edit
 *
 * @see https://discord.com/developers/docs
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Import types and classes we'll create
import {
  Client,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ModalBuilder,
  TextInputBuilder,
  StringSelectMenuBuilder,
  GatewayIntentBits,
  ButtonStyle,
  TextInputStyle,
  ChannelType,
  PermissionFlagsBits,
  DiscordError,
  type ClientOptions,
  type Message,
  type Channel,
  type Guild,
  type GuildMember,
  type Role,
  type User,
  type Interaction,
  type CommandInteraction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type Webhook,
} from '../src/index'

// ============================================================================
// CLIENT TESTS
// ============================================================================

describe('Client', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('construction', () => {
    it('should create client with intents', () => {
      const client = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
      })
      expect(client).toBeDefined()
    })

    it('should create client with numeric intents', () => {
      const client = new Client({
        intents: GatewayIntentBits.Guilds | GatewayIntentBits.GuildMessages,
      })
      expect(client).toBeDefined()
    })

    it('should have event emitter methods', () => {
      const client = new Client({ intents: [] })
      expect(typeof client.on).toBe('function')
      expect(typeof client.once).toBe('function')
      expect(typeof client.off).toBe('function')
      expect(typeof client.emit).toBe('function')
    })

    it('should have user property after login', async () => {
      const client = new Client({ intents: [] })

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: '123456789',
          username: 'TestBot',
          discriminator: '0000',
          avatar: null,
          bot: true,
        }),
      })

      // Simulate ready state
      await client.login('test-token')

      expect(client.user).toBeDefined()
      expect(client.user?.tag).toBe('TestBot#0000')
    })
  })

  describe('events', () => {
    it('should emit ready event', async () => {
      const client = new Client({ intents: [] })
      const readyHandler = vi.fn()

      client.on('ready', readyHandler)

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: '123',
          username: 'Bot',
          discriminator: '0000',
          bot: true,
        }),
      })

      await client.login('test-token')

      expect(readyHandler).toHaveBeenCalled()
    })

    it('should emit messageCreate event', async () => {
      const client = new Client({
        intents: [GatewayIntentBits.GuildMessages],
      })
      const messageHandler = vi.fn()

      client.on('messageCreate', messageHandler)

      // Simulate receiving a message (internal event dispatch)
      client._handleGatewayEvent('MESSAGE_CREATE', {
        id: '123',
        channel_id: '456',
        content: 'Hello!',
        author: { id: '789', username: 'User', discriminator: '1234' },
      })

      expect(messageHandler).toHaveBeenCalled()
      const message = messageHandler.mock.calls[0][0]
      expect(message.content).toBe('Hello!')
    })

    it('should emit interactionCreate event', async () => {
      const client = new Client({ intents: [] })
      const interactionHandler = vi.fn()

      client.on('interactionCreate', interactionHandler)

      // Simulate slash command interaction
      client._handleGatewayEvent('INTERACTION_CREATE', {
        id: '123',
        type: 2, // APPLICATION_COMMAND
        data: { name: 'ping' },
        channel_id: '456',
        guild_id: '789',
      })

      expect(interactionHandler).toHaveBeenCalled()
    })
  })

  describe('login', () => {
    it('should store token and fetch bot user', async () => {
      const client = new Client({ intents: [] })

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: '123',
          username: 'Bot',
          discriminator: '0000',
          bot: true,
        }),
      })

      await client.login('bot-token')

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/users/@me'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bot bot-token',
          }),
        })
      )
    })

    it('should throw on invalid token', async () => {
      const client = new Client({ intents: [] })

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: '401: Unauthorized' }),
      })

      await expect(client.login('invalid-token')).rejects.toThrow()
    })
  })

  describe('destroy', () => {
    it('should disconnect and clear state', async () => {
      const client = new Client({ intents: [] })

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: '123',
          username: 'Bot',
          discriminator: '0000',
          bot: true,
        }),
      })

      await client.login('test-token')
      expect(client.user).toBeDefined()

      client.destroy()
      expect(client.user).toBeNull()
    })
  })
})

// ============================================================================
// REST API TESTS
// ============================================================================

describe('REST', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('construction', () => {
    it('should create REST client with version', () => {
      const rest = new REST({ version: '10' })
      expect(rest).toBeDefined()
    })

    it('should set token', () => {
      const rest = new REST({ version: '10' }).setToken('bot-token')
      expect(rest).toBeDefined()
    })
  })

  describe('requests', () => {
    it('should make GET request', async () => {
      const rest = new REST({ version: '10' }).setToken('bot-token')

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: '123' }),
      })

      const result = await rest.get(Routes.user('123'))

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/users/123'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bot bot-token',
          }),
        })
      )
      expect(result).toEqual({ id: '123' })
    })

    it('should make POST request with body', async () => {
      const rest = new REST({ version: '10' }).setToken('bot-token')

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: '123' }),
      })

      await rest.post(Routes.channelMessages('456'), {
        body: { content: 'Hello!' },
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      expect(fetchCall[1].method).toBe('POST')
      expect(JSON.parse(fetchCall[1].body)).toEqual({ content: 'Hello!' })
    })

    it('should make PUT request', async () => {
      const rest = new REST({ version: '10' }).setToken('bot-token')

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ([]),
      })

      await rest.put(Routes.applicationGuildCommands('client-id', 'guild-id'), {
        body: [],
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      expect(fetchCall[1].method).toBe('PUT')
    })

    it('should make PATCH request', async () => {
      const rest = new REST({ version: '10' }).setToken('bot-token')

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: '123' }),
      })

      await rest.patch(Routes.channelMessage('456', '789'), {
        body: { content: 'Updated!' },
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      expect(fetchCall[1].method).toBe('PATCH')
    })

    it('should make DELETE request', async () => {
      const rest = new REST({ version: '10' }).setToken('bot-token')

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => ({}),
      })

      await rest.delete(Routes.channelMessage('456', '789'))

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      expect(fetchCall[1].method).toBe('DELETE')
    })

    it('should handle rate limiting', async () => {
      const rest = new REST({ version: '10' }).setToken('bot-token')

      let callCount = 0
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return Promise.resolve({
            ok: false,
            status: 429,
            headers: new Headers({ 'Retry-After': '0.1' }),
            json: async () => ({ message: 'Rate limited', retry_after: 0.1 }),
          })
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: '123' }),
        })
      })

      const result = await rest.get(Routes.user('123'))
      expect(result).toEqual({ id: '123' })
      expect(callCount).toBe(2)
    })

    it('should throw DiscordError on API error', async () => {
      const rest = new REST({ version: '10' }).setToken('bot-token')

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ message: 'Unknown User', code: 10013 }),
      })

      await expect(rest.get(Routes.user('invalid'))).rejects.toThrow(DiscordError)
    })
  })
})

// ============================================================================
// ROUTES TESTS
// ============================================================================

describe('Routes', () => {
  it('should generate user route', () => {
    expect(Routes.user('123')).toBe('/users/123')
  })

  it('should generate channel route', () => {
    expect(Routes.channel('123')).toBe('/channels/123')
  })

  it('should generate channel messages route', () => {
    expect(Routes.channelMessages('123')).toBe('/channels/123/messages')
  })

  it('should generate channel message route', () => {
    expect(Routes.channelMessage('123', '456')).toBe('/channels/123/messages/456')
  })

  it('should generate guild route', () => {
    expect(Routes.guild('123')).toBe('/guilds/123')
  })

  it('should generate guild channels route', () => {
    expect(Routes.guildChannels('123')).toBe('/guilds/123/channels')
  })

  it('should generate guild members route', () => {
    expect(Routes.guildMembers('123')).toBe('/guilds/123/members')
  })

  it('should generate guild member route', () => {
    expect(Routes.guildMember('123', '456')).toBe('/guilds/123/members/456')
  })

  it('should generate guild roles route', () => {
    expect(Routes.guildRoles('123')).toBe('/guilds/123/roles')
  })

  it('should generate application commands route', () => {
    expect(Routes.applicationCommands('123')).toBe('/applications/123/commands')
  })

  it('should generate application guild commands route', () => {
    expect(Routes.applicationGuildCommands('123', '456')).toBe(
      '/applications/123/guilds/456/commands'
    )
  })

  it('should generate interaction callback route', () => {
    expect(Routes.interactionCallback('123', 'token')).toBe(
      '/interactions/123/token/callback'
    )
  })

  it('should generate webhook route', () => {
    expect(Routes.webhook('123')).toBe('/webhooks/123')
  })

  it('should generate channel webhooks route', () => {
    expect(Routes.channelWebhooks('123')).toBe('/channels/123/webhooks')
  })

  it('should generate webhook with token route', () => {
    expect(Routes.webhookWithToken('123', 'token')).toBe('/webhooks/123/token')
  })

  it('should generate message reactions route', () => {
    expect(Routes.channelMessageReaction('123', '456', '👍')).toBe(
      '/channels/123/messages/456/reactions/%F0%9F%91%8D/@me'
    )
  })

  it('should generate threads route', () => {
    expect(Routes.threads('123', '456')).toBe('/channels/123/messages/456/threads')
  })
})

// ============================================================================
// MESSAGES API TESTS
// ============================================================================

describe('Messages API', () => {
  let rest: REST
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    rest = new REST({ version: '10' }).setToken('bot-token')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('send message', () => {
    it('should send a simple text message', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: '123',
          channel_id: '456',
          content: 'Hello, World!',
          author: { id: '789', username: 'Bot', discriminator: '0000' },
        }),
      })

      const result = await rest.post(Routes.channelMessages('456'), {
        body: { content: 'Hello, World!' },
      }) as Message

      expect(result.content).toBe('Hello, World!')
    })

    it('should send message with embeds', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: '123',
          embeds: [{ title: 'Test', description: 'Description' }],
        }),
      })

      const embed = new EmbedBuilder()
        .setTitle('Test')
        .setDescription('Description')
        .setColor(0x00ff00)

      await rest.post(Routes.channelMessages('456'), {
        body: {
          embeds: [embed.toJSON()],
        },
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.embeds[0].title).toBe('Test')
    })

    it('should send message with components', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: '123' }),
      })

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('btn1')
          .setLabel('Click Me')
          .setStyle(ButtonStyle.Primary)
      )

      await rest.post(Routes.channelMessages('456'), {
        body: {
          content: 'Interactive message',
          components: [row.toJSON()],
        },
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.components).toBeDefined()
      expect(body.components[0].components[0].custom_id).toBe('btn1')
    })

    it('should reply to a message', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: '123',
          message_reference: { message_id: '456' },
        }),
      })

      await rest.post(Routes.channelMessages('chan'), {
        body: {
          content: 'Reply!',
          message_reference: { message_id: '456' },
        },
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.message_reference.message_id).toBe('456')
    })
  })

  describe('edit message', () => {
    it('should edit message content', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: '123',
          content: 'Updated content',
        }),
      })

      const result = await rest.patch(Routes.channelMessage('456', '123'), {
        body: { content: 'Updated content' },
      }) as Message

      expect(result.content).toBe('Updated content')
    })

    it('should edit message embeds', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: '123',
          embeds: [{ title: 'Updated' }],
        }),
      })

      await rest.patch(Routes.channelMessage('456', '123'), {
        body: {
          embeds: [new EmbedBuilder().setTitle('Updated').toJSON()],
        },
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.embeds[0].title).toBe('Updated')
    })
  })

  describe('delete message', () => {
    it('should delete a message', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => ({}),
      })

      await rest.delete(Routes.channelMessage('456', '123'))

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      expect(fetchCall[1].method).toBe('DELETE')
      expect(fetchCall[0]).toContain('/channels/456/messages/123')
    })

    it('should bulk delete messages', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => ({}),
      })

      await rest.post(Routes.channelBulkDelete('456'), {
        body: { messages: ['123', '124', '125'] },
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.messages).toHaveLength(3)
    })
  })

  describe('reactions', () => {
    it('should add a reaction', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => ({}),
      })

      await rest.put(Routes.channelMessageReaction('456', '123', '👍'))

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      expect(fetchCall[1].method).toBe('PUT')
      expect(fetchCall[0]).toContain('reactions')
    })

    it('should remove own reaction', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => ({}),
      })

      await rest.delete(Routes.channelMessageReaction('456', '123', '👍'))

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      expect(fetchCall[1].method).toBe('DELETE')
    })

    it('should get reactions', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ([
          { id: '1', username: 'User1' },
          { id: '2', username: 'User2' },
        ]),
      })

      const result = await rest.get(Routes.channelMessageReactions('456', '123', '👍')) as User[]

      expect(result).toHaveLength(2)
    })
  })

  describe('threads', () => {
    it('should create a thread from message', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: '789',
          name: 'Thread Name',
          type: ChannelType.PublicThread,
          parent_id: '456',
        }),
      })

      const result = await rest.post(Routes.threads('456', '123'), {
        body: {
          name: 'Thread Name',
          auto_archive_duration: 60,
        },
      }) as Channel

      expect(result.name).toBe('Thread Name')
    })

    it('should join a thread', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => ({}),
      })

      await rest.put(Routes.threadMembers('789', '@me'))

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      expect(fetchCall[0]).toContain('/thread-members/@me')
    })
  })
})

// ============================================================================
// CHANNELS API TESTS
// ============================================================================

describe('Channels API', () => {
  let rest: REST
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    rest = new REST({ version: '10' }).setToken('bot-token')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('get channel', () => {
    it('should get channel info', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: '123',
          name: 'general',
          type: ChannelType.GuildText,
          guild_id: '456',
        }),
      })

      const result = await rest.get(Routes.channel('123')) as Channel

      expect(result.name).toBe('general')
      expect(result.type).toBe(ChannelType.GuildText)
    })
  })

  describe('create channel', () => {
    it('should create a text channel', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: '789',
          name: 'new-channel',
          type: ChannelType.GuildText,
        }),
      })

      const result = await rest.post(Routes.guildChannels('456'), {
        body: {
          name: 'new-channel',
          type: ChannelType.GuildText,
        },
      }) as Channel

      expect(result.name).toBe('new-channel')
    })

    it('should create a voice channel', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: '789',
          name: 'Voice Room',
          type: ChannelType.GuildVoice,
        }),
      })

      await rest.post(Routes.guildChannels('456'), {
        body: {
          name: 'Voice Room',
          type: ChannelType.GuildVoice,
          bitrate: 64000,
        },
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.type).toBe(ChannelType.GuildVoice)
    })

    it('should create channel with permissions', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: '789' }),
      })

      await rest.post(Routes.guildChannels('456'), {
        body: {
          name: 'private-channel',
          type: ChannelType.GuildText,
          permission_overwrites: [
            {
              id: '123', // role id
              type: 0, // role
              deny: String(PermissionFlagsBits.ViewChannel),
            },
          ],
        },
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.permission_overwrites).toBeDefined()
    })
  })

  describe('edit channel', () => {
    it('should edit channel name', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: '123',
          name: 'renamed-channel',
        }),
      })

      const result = await rest.patch(Routes.channel('123'), {
        body: { name: 'renamed-channel' },
      }) as Channel

      expect(result.name).toBe('renamed-channel')
    })

    it('should edit channel topic', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: '123',
          topic: 'New topic',
        }),
      })

      await rest.patch(Routes.channel('123'), {
        body: { topic: 'New topic' },
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.topic).toBe('New topic')
    })

    it('should set channel permissions', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => ({}),
      })

      await rest.put(Routes.channelPermission('123', '456'), {
        body: {
          type: 0, // role
          allow: String(PermissionFlagsBits.SendMessages),
          deny: '0',
        },
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      expect(fetchCall[0]).toContain('/permissions/')
    })
  })

  describe('delete channel', () => {
    it('should delete a channel', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: '123' }),
      })

      await rest.delete(Routes.channel('123'))

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      expect(fetchCall[1].method).toBe('DELETE')
    })
  })
})

// ============================================================================
// GUILDS API TESTS
// ============================================================================

describe('Guilds API', () => {
  let rest: REST
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    rest = new REST({ version: '10' }).setToken('bot-token')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('get guild', () => {
    it('should get guild info', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: '123',
          name: 'Test Server',
          icon: 'hash',
          owner_id: '456',
          member_count: 100,
        }),
      })

      const result = await rest.get(Routes.guild('123')) as Guild

      expect(result.name).toBe('Test Server')
      expect(result.member_count).toBe(100)
    })
  })

  describe('roles', () => {
    it('should get guild roles', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ([
          { id: '1', name: '@everyone', position: 0 },
          { id: '2', name: 'Admin', position: 1 },
        ]),
      })

      const result = await rest.get(Routes.guildRoles('123')) as Role[]

      expect(result).toHaveLength(2)
      expect(result[1].name).toBe('Admin')
    })

    it('should create a role', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: '789',
          name: 'New Role',
          color: 0xff0000,
        }),
      })

      const result = await rest.post(Routes.guildRoles('123'), {
        body: {
          name: 'New Role',
          color: 0xff0000,
          permissions: '0',
        },
      }) as Role

      expect(result.name).toBe('New Role')
    })

    it('should edit a role', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: '789',
          name: 'Updated Role',
        }),
      })

      await rest.patch(Routes.guildRole('123', '789'), {
        body: { name: 'Updated Role' },
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      expect(fetchCall[0]).toContain('/roles/789')
    })

    it('should delete a role', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => ({}),
      })

      await rest.delete(Routes.guildRole('123', '789'))

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      expect(fetchCall[1].method).toBe('DELETE')
    })
  })

  describe('members', () => {
    it('should get guild members', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ([
          { user: { id: '1', username: 'User1' }, roles: ['2'] },
          { user: { id: '2', username: 'User2' }, roles: [] },
        ]),
      })

      const result = await rest.get(Routes.guildMembers('123'), {
        query: { limit: 100 },
      }) as GuildMember[]

      expect(result).toHaveLength(2)
    })

    it('should get specific guild member', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          user: { id: '456', username: 'TestUser' },
          nick: 'Nickname',
          roles: ['789'],
          joined_at: '2024-01-01T00:00:00.000Z',
        }),
      })

      const result = await rest.get(Routes.guildMember('123', '456')) as GuildMember

      expect(result.user.username).toBe('TestUser')
      expect(result.nick).toBe('Nickname')
    })

    it('should modify guild member', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          user: { id: '456' },
          nick: 'New Nick',
        }),
      })

      await rest.patch(Routes.guildMember('123', '456'), {
        body: { nick: 'New Nick' },
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.nick).toBe('New Nick')
    })

    it('should add role to member', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => ({}),
      })

      await rest.put(Routes.guildMemberRole('123', '456', '789'))

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      expect(fetchCall[0]).toContain('/roles/789')
    })

    it('should remove role from member', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => ({}),
      })

      await rest.delete(Routes.guildMemberRole('123', '456', '789'))

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      expect(fetchCall[1].method).toBe('DELETE')
    })
  })
})

// ============================================================================
// INTERACTIONS API TESTS
// ============================================================================

describe('Interactions API', () => {
  let rest: REST
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    rest = new REST({ version: '10' }).setToken('bot-token')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('SlashCommandBuilder', () => {
    it('should build a simple command', () => {
      const command = new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Replies with Pong!')

      const json = command.toJSON()
      expect(json.name).toBe('ping')
      expect(json.description).toBe('Replies with Pong!')
    })

    it('should build command with string option', () => {
      const command = new SlashCommandBuilder()
        .setName('echo')
        .setDescription('Echoes input')
        .addStringOption(option =>
          option
            .setName('message')
            .setDescription('The message to echo')
            .setRequired(true)
        )

      const json = command.toJSON()
      expect(json.options).toHaveLength(1)
      expect(json.options![0].name).toBe('message')
      expect(json.options![0].required).toBe(true)
    })

    it('should build command with integer option', () => {
      const command = new SlashCommandBuilder()
        .setName('roll')
        .setDescription('Roll dice')
        .addIntegerOption(option =>
          option
            .setName('sides')
            .setDescription('Number of sides')
            .setMinValue(2)
            .setMaxValue(100)
        )

      const json = command.toJSON()
      expect(json.options![0].min_value).toBe(2)
      expect(json.options![0].max_value).toBe(100)
    })

    it('should build command with choices', () => {
      const command = new SlashCommandBuilder()
        .setName('choose')
        .setDescription('Choose an option')
        .addStringOption(option =>
          option
            .setName('choice')
            .setDescription('Your choice')
            .addChoices(
              { name: 'Option A', value: 'a' },
              { name: 'Option B', value: 'b' }
            )
        )

      const json = command.toJSON()
      expect(json.options![0].choices).toHaveLength(2)
    })

    it('should build command with subcommands', () => {
      const command = new SlashCommandBuilder()
        .setName('settings')
        .setDescription('Manage settings')
        .addSubcommand(sub =>
          sub.setName('view').setDescription('View settings')
        )
        .addSubcommand(sub =>
          sub.setName('edit').setDescription('Edit settings')
        )

      const json = command.toJSON()
      expect(json.options).toHaveLength(2)
      expect(json.options![0].type).toBe(1) // SUB_COMMAND
    })
  })

  describe('register commands', () => {
    it('should register global commands', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ([]),
      })

      const commands = [
        new SlashCommandBuilder()
          .setName('ping')
          .setDescription('Pong!'),
      ]

      await rest.put(Routes.applicationCommands('client-id'), {
        body: commands.map(c => c.toJSON()),
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      expect(fetchCall[0]).toContain('/applications/client-id/commands')
    })

    it('should register guild commands', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ([]),
      })

      const commands = [
        new SlashCommandBuilder()
          .setName('test')
          .setDescription('Test command'),
      ]

      await rest.put(Routes.applicationGuildCommands('client-id', 'guild-id'), {
        body: commands.map(c => c.toJSON()),
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      expect(fetchCall[0]).toContain('/guilds/guild-id/commands')
    })
  })

  describe('respond to interactions', () => {
    it('should respond to slash command', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => ({}),
      })

      await rest.post(Routes.interactionCallback('123', 'token'), {
        body: {
          type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
          data: { content: 'Pong!' },
        },
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.type).toBe(4)
      expect(body.data.content).toBe('Pong!')
    })

    it('should defer response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => ({}),
      })

      await rest.post(Routes.interactionCallback('123', 'token'), {
        body: {
          type: 5, // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
        },
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.type).toBe(5)
    })

    it('should respond with ephemeral message', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => ({}),
      })

      await rest.post(Routes.interactionCallback('123', 'token'), {
        body: {
          type: 4,
          data: {
            content: 'Only you can see this',
            flags: 64, // EPHEMERAL
          },
        },
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.data.flags).toBe(64)
    })

    it('should edit original response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: '123' }),
      })

      await rest.patch(Routes.webhookMessage('app-id', 'token', '@original'), {
        body: { content: 'Updated!' },
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      expect(fetchCall[0]).toContain('/@original')
    })
  })

  describe('buttons', () => {
    it('should build button row', () => {
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('primary')
          .setLabel('Primary')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('secondary')
          .setLabel('Secondary')
          .setStyle(ButtonStyle.Secondary)
      )

      const json = row.toJSON()
      expect(json.components).toHaveLength(2)
      expect(json.components[0].style).toBe(ButtonStyle.Primary)
    })

    it('should build link button', () => {
      const button = new ButtonBuilder()
        .setLabel('Visit')
        .setStyle(ButtonStyle.Link)
        .setURL('https://example.com')

      const json = button.toJSON()
      expect(json.style).toBe(ButtonStyle.Link)
      expect(json.url).toBe('https://example.com')
    })

    it('should build button with emoji', () => {
      const button = new ButtonBuilder()
        .setCustomId('emoji-btn')
        .setLabel('Like')
        .setStyle(ButtonStyle.Primary)
        .setEmoji({ name: '👍' })

      const json = button.toJSON()
      expect(json.emoji?.name).toBe('👍')
    })

    it('should build disabled button', () => {
      const button = new ButtonBuilder()
        .setCustomId('disabled')
        .setLabel('Disabled')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true)

      const json = button.toJSON()
      expect(json.disabled).toBe(true)
    })
  })

  describe('select menus', () => {
    it('should build string select menu', () => {
      const select = new StringSelectMenuBuilder()
        .setCustomId('select-menu')
        .setPlaceholder('Choose an option')
        .addOptions(
          { label: 'Option 1', value: '1' },
          { label: 'Option 2', value: '2' }
        )

      const json = select.toJSON()
      expect(json.custom_id).toBe('select-menu')
      expect(json.options).toHaveLength(2)
    })

    it('should set min/max values', () => {
      const select = new StringSelectMenuBuilder()
        .setCustomId('multi-select')
        .setMinValues(1)
        .setMaxValues(3)
        .addOptions(
          { label: 'A', value: 'a' },
          { label: 'B', value: 'b' },
          { label: 'C', value: 'c' }
        )

      const json = select.toJSON()
      expect(json.min_values).toBe(1)
      expect(json.max_values).toBe(3)
    })
  })

  describe('modals', () => {
    it('should build modal', () => {
      const modal = new ModalBuilder()
        .setCustomId('my-modal')
        .setTitle('My Modal')
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId('input1')
              .setLabel('Input')
              .setStyle(TextInputStyle.Short)
          )
        )

      const json = modal.toJSON()
      expect(json.custom_id).toBe('my-modal')
      expect(json.title).toBe('My Modal')
      expect(json.components).toHaveLength(1)
    })

    it('should build text input with placeholder', () => {
      const input = new TextInputBuilder()
        .setCustomId('text-input')
        .setLabel('Enter text')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Type here...')
        .setRequired(true)
        .setMinLength(10)
        .setMaxLength(1000)

      const json = input.toJSON()
      expect(json.placeholder).toBe('Type here...')
      expect(json.required).toBe(true)
      expect(json.min_length).toBe(10)
      expect(json.max_length).toBe(1000)
    })

    it('should respond with modal', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => ({}),
      })

      const modal = new ModalBuilder()
        .setCustomId('test-modal')
        .setTitle('Test')
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId('input')
              .setLabel('Input')
              .setStyle(TextInputStyle.Short)
          )
        )

      await rest.post(Routes.interactionCallback('123', 'token'), {
        body: {
          type: 9, // MODAL
          data: modal.toJSON(),
        },
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.type).toBe(9)
      expect(body.data.custom_id).toBe('test-modal')
    })
  })
})

// ============================================================================
// WEBHOOKS API TESTS
// ============================================================================

describe('Webhooks API', () => {
  let rest: REST
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    rest = new REST({ version: '10' }).setToken('bot-token')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('create webhook', () => {
    it('should create a webhook', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: '123',
          token: 'webhook-token',
          name: 'Test Hook',
          channel_id: '456',
        }),
      })

      const result = await rest.post(Routes.channelWebhooks('456'), {
        body: { name: 'Test Hook' },
      }) as Webhook

      expect(result.name).toBe('Test Hook')
      expect(result.token).toBe('webhook-token')
    })

    it('should create webhook with avatar', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: '123' }),
      })

      await rest.post(Routes.channelWebhooks('456'), {
        body: {
          name: 'Avatar Hook',
          avatar: 'data:image/png;base64,iVBORw0KGgo...',
        },
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.avatar).toBeDefined()
    })
  })

  describe('execute webhook', () => {
    it('should execute webhook with content', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: '789' }),
      })

      // Execute without token in REST (webhook token in URL)
      const webhookRest = new REST({ version: '10' })

      await webhookRest.post(Routes.webhookWithToken('123', 'webhook-token'), {
        body: { content: 'Hello from webhook!' },
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.content).toBe('Hello from webhook!')
    })

    it('should execute webhook with embeds', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      })

      const webhookRest = new REST({ version: '10' })

      await webhookRest.post(Routes.webhookWithToken('123', 'token'), {
        body: {
          embeds: [
            new EmbedBuilder()
              .setTitle('Webhook Embed')
              .setDescription('Description')
              .toJSON(),
          ],
        },
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.embeds[0].title).toBe('Webhook Embed')
    })

    it('should execute webhook with username override', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      })

      const webhookRest = new REST({ version: '10' })

      await webhookRest.post(Routes.webhookWithToken('123', 'token'), {
        body: {
          content: 'Message',
          username: 'Custom Name',
          avatar_url: 'https://example.com/avatar.png',
        },
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.username).toBe('Custom Name')
      expect(body.avatar_url).toBe('https://example.com/avatar.png')
    })

    it('should execute webhook and wait for message', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: '789',
          content: 'Webhook message',
        }),
      })

      const webhookRest = new REST({ version: '10' })

      const result = await webhookRest.post(
        `${Routes.webhookWithToken('123', 'token')}?wait=true`,
        { body: { content: 'Test' } }
      ) as Message

      expect(result.id).toBe('789')
    })
  })

  describe('edit webhook', () => {
    it('should edit webhook name', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: '123',
          name: 'Updated Hook',
        }),
      })

      const result = await rest.patch(Routes.webhook('123'), {
        body: { name: 'Updated Hook' },
      }) as Webhook

      expect(result.name).toBe('Updated Hook')
    })

    it('should edit webhook with token', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: '123' }),
      })

      const webhookRest = new REST({ version: '10' })

      await webhookRest.patch(Routes.webhookWithToken('123', 'token'), {
        body: { name: 'New Name' },
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      // No Authorization header when using webhook token
      expect(fetchCall[1].headers).not.toHaveProperty('Authorization')
    })
  })

  describe('delete webhook', () => {
    it('should delete a webhook', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => ({}),
      })

      await rest.delete(Routes.webhook('123'))

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      expect(fetchCall[1].method).toBe('DELETE')
    })
  })

  describe('edit webhook message', () => {
    it('should edit a webhook message', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: '789',
          content: 'Updated content',
        }),
      })

      const webhookRest = new REST({ version: '10' })

      const result = await webhookRest.patch(
        Routes.webhookMessage('123', 'token', '789'),
        { body: { content: 'Updated content' } }
      ) as Message

      expect(result.content).toBe('Updated content')
    })
  })

  describe('delete webhook message', () => {
    it('should delete a webhook message', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => ({}),
      })

      const webhookRest = new REST({ version: '10' })

      await webhookRest.delete(Routes.webhookMessage('123', 'token', '789'))

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      expect(fetchCall[1].method).toBe('DELETE')
    })
  })
})

// ============================================================================
// EMBED BUILDER TESTS
// ============================================================================

describe('EmbedBuilder', () => {
  it('should build embed with all fields', () => {
    const embed = new EmbedBuilder()
      .setTitle('Title')
      .setDescription('Description')
      .setURL('https://example.com')
      .setColor(0xff0000)
      .setTimestamp()
      .setFooter({ text: 'Footer', iconURL: 'https://example.com/icon.png' })
      .setThumbnail('https://example.com/thumb.png')
      .setImage('https://example.com/image.png')
      .setAuthor({
        name: 'Author',
        iconURL: 'https://example.com/author.png',
        url: 'https://example.com',
      })
      .addFields(
        { name: 'Field 1', value: 'Value 1' },
        { name: 'Field 2', value: 'Value 2', inline: true }
      )

    const json = embed.toJSON()
    expect(json.title).toBe('Title')
    expect(json.description).toBe('Description')
    expect(json.url).toBe('https://example.com')
    expect(json.color).toBe(0xff0000)
    expect(json.timestamp).toBeDefined()
    expect(json.footer?.text).toBe('Footer')
    expect(json.thumbnail?.url).toBe('https://example.com/thumb.png')
    expect(json.image?.url).toBe('https://example.com/image.png')
    expect(json.author?.name).toBe('Author')
    expect(json.fields).toHaveLength(2)
  })

  it('should set timestamp with Date', () => {
    const date = new Date('2025-01-01T00:00:00.000Z')
    const embed = new EmbedBuilder().setTimestamp(date)

    const json = embed.toJSON()
    expect(json.timestamp).toBe('2025-01-01T00:00:00.000Z')
  })

  it('should set fields', () => {
    const embed = new EmbedBuilder()
      .setFields([
        { name: 'A', value: '1' },
        { name: 'B', value: '2' },
      ])

    const json = embed.toJSON()
    expect(json.fields).toHaveLength(2)
  })

  it('should splice fields', () => {
    const embed = new EmbedBuilder()
      .addFields(
        { name: 'A', value: '1' },
        { name: 'B', value: '2' },
        { name: 'C', value: '3' }
      )
      .spliceFields(1, 1, { name: 'New', value: 'New Value' })

    const json = embed.toJSON()
    expect(json.fields).toHaveLength(3)
    expect(json.fields![1].name).toBe('New')
  })
})

// ============================================================================
// GATEWAY INTENT BITS TESTS
// ============================================================================

describe('GatewayIntentBits', () => {
  it('should have correct intent values', () => {
    expect(GatewayIntentBits.Guilds).toBe(1 << 0)
    expect(GatewayIntentBits.GuildMembers).toBe(1 << 1)
    expect(GatewayIntentBits.GuildModeration).toBe(1 << 2)
    expect(GatewayIntentBits.GuildMessages).toBe(1 << 9)
    expect(GatewayIntentBits.DirectMessages).toBe(1 << 12)
    expect(GatewayIntentBits.MessageContent).toBe(1 << 15)
  })

  it('should combine intents with bitwise OR', () => {
    const combined = GatewayIntentBits.Guilds | GatewayIntentBits.GuildMessages
    expect(combined).toBe((1 << 0) | (1 << 9))
  })
})

// ============================================================================
// PERMISSION FLAG BITS TESTS
// ============================================================================

describe('PermissionFlagsBits', () => {
  it('should have correct permission values', () => {
    expect(PermissionFlagsBits.ViewChannel).toBe(1n << 10n)
    expect(PermissionFlagsBits.SendMessages).toBe(1n << 11n)
    expect(PermissionFlagsBits.ManageMessages).toBe(1n << 13n)
    expect(PermissionFlagsBits.Administrator).toBe(1n << 3n)
  })
})

// ============================================================================
// DISCORD ERROR TESTS
// ============================================================================

describe('DiscordError', () => {
  it('should create error with code and message', () => {
    const error = new DiscordError(10013, 'Unknown User')
    expect(error.code).toBe(10013)
    expect(error.message).toContain('Unknown User')
  })

  it('should include HTTP status', () => {
    const error = new DiscordError(10013, 'Unknown User', 404)
    expect(error.status).toBe(404)
  })

  it('should have isDiscordError property', () => {
    const error = new DiscordError(0, 'Test')
    expect(error.isDiscordError).toBe(true)
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Integration', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should work with realistic bot scenario', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: '123',
          username: 'TestBot',
          discriminator: '0000',
          bot: true,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ([]),
      })

    const client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    })

    const rest = new REST({ version: '10' }).setToken('bot-token')

    // Login first (uses first mock)
    await client.login('bot-token')

    expect(client.user?.tag).toBe('TestBot#0000')

    // Register commands (uses second mock)
    const commands = [
      new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Pong!'),
      new SlashCommandBuilder()
        .setName('echo')
        .setDescription('Echo message')
        .addStringOption(opt =>
          opt.setName('message').setDescription('Message').setRequired(true)
        ),
    ]

    await rest.put(Routes.applicationGuildCommands('client-id', 'guild-id'), {
      body: commands.map(c => c.toJSON()),
    })
  })

  it('should work with webhook integration', async () => {
    let messageCount = 0

    globalThis.fetch = vi.fn().mockImplementation(() => {
      messageCount++
      return Promise.resolve({
        ok: true,
        json: async () => ({
          id: String(messageCount),
          content: `Message ${messageCount}`,
        }),
      })
    })

    const rest = new REST({ version: '10' })

    // Send multiple webhook messages
    for (let i = 0; i < 3; i++) {
      await rest.post(Routes.webhookWithToken('webhook-id', 'webhook-token'), {
        body: {
          content: `Update ${i + 1}`,
          embeds: [
            new EmbedBuilder()
              .setTitle(`Update ${i + 1}`)
              .setColor(0x00ff00)
              .toJSON(),
          ],
        },
      })
    }

    expect(messageCount).toBe(3)
  })
})

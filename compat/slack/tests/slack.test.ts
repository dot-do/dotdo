/**
 * @dotdo/slack - Slack SDK Compat Layer Tests
 *
 * Comprehensive tests for Slack Web API compatibility:
 * - WebClient creation and configuration
 * - chat.postMessage, chat.update, chat.delete
 * - conversations.list, conversations.history
 * - users.list, users.info
 * - Block Kit builder
 *
 * @see https://api.slack.com/methods
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Import types and classes we'll create
import {
  WebClient,
  type WebClientOptions,
  type ChatPostMessageArguments,
  type ChatPostMessageResponse,
  type ChatUpdateArguments,
  type ChatUpdateResponse,
  type ChatDeleteArguments,
  type ChatDeleteResponse,
  type ConversationsListArguments,
  type ConversationsListResponse,
  type ConversationsHistoryArguments,
  type ConversationsHistoryResponse,
  type UsersListArguments,
  type UsersListResponse,
  type UsersInfoArguments,
  type UsersInfoResponse,
  type SlackMessage,
  type SlackChannel,
  type SlackUser,
  SlackError,
} from '../index'

// Import Block Kit builder
import {
  Blocks,
  section,
  divider,
  header,
  context,
  actions,
  image,
  input,
  plainText,
  mrkdwn,
  button,
  staticSelect,
  option,
  overflow,
  datePicker,
  timePicker,
  textInput,
  type Block,
  type SectionBlock,
  type ActionsBlock,
} from '../blocks'

// ============================================================================
// WEB CLIENT TESTS
// ============================================================================

describe('WebClient', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('construction', () => {
    it('should create client with token', () => {
      const client = new WebClient('xoxb-test-token')
      expect(client).toBeDefined()
    })

    it('should create client with options', () => {
      const client = new WebClient('xoxb-test-token', {
        timeout: 30000,
        retryConfig: { retries: 3 },
      })
      expect(client).toBeDefined()
    })

    it('should create client without token', () => {
      const client = new WebClient()
      expect(client).toBeDefined()
    })

    it('should allow setting token after creation', () => {
      const client = new WebClient()
      client.token = 'xoxb-new-token'
      expect(client.token).toBe('xoxb-new-token')
    })
  })

  describe('API call mechanics', () => {
    it('should include auth header in requests', async () => {
      const client = new WebClient('xoxb-test-token')

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, messages: [] }),
      })

      await client.conversations.history({ channel: 'C123' })

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('conversations.history'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer xoxb-test-token',
          }),
        })
      )
    })

    it('should handle Slack API errors', async () => {
      const client = new WebClient('xoxb-test-token')

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: false,
          error: 'channel_not_found',
        }),
      })

      await expect(
        client.chat.postMessage({ channel: 'invalid', text: 'test' })
      ).rejects.toThrow(SlackError)
    })

    it('should handle network errors', async () => {
      const client = new WebClient('xoxb-test-token')

      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

      await expect(
        client.chat.postMessage({ channel: 'C123', text: 'test' })
      ).rejects.toThrow()
    })

    it('should handle rate limiting', async () => {
      const client = new WebClient('xoxb-test-token', {
        retryConfig: { retries: 1 },
      })

      let callCount = 0
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              ok: false,
              error: 'rate_limited',
            }),
            headers: new Headers({ 'Retry-After': '1' }),
          })
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ ok: true, ts: '123' }),
        })
      })

      // With retry enabled, should eventually succeed
      const result = await client.chat.postMessage({ channel: 'C123', text: 'test' })
      expect(result.ok).toBe(true)
    })
  })
})

// ============================================================================
// CHAT API TESTS
// ============================================================================

describe('chat API', () => {
  let client: WebClient
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    client = new WebClient('xoxb-test-token')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('chat.postMessage', () => {
    it('should post a simple text message', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          channel: 'C123',
          ts: '1234567890.123456',
          message: {
            type: 'message',
            text: 'Hello, World!',
            user: 'U123',
            ts: '1234567890.123456',
          },
        }),
      })

      const result = await client.chat.postMessage({
        channel: 'C123',
        text: 'Hello, World!',
      })

      expect(result.ok).toBe(true)
      expect(result.channel).toBe('C123')
      expect(result.ts).toBe('1234567890.123456')
      expect(result.message?.text).toBe('Hello, World!')
    })

    it('should post message with blocks', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          channel: 'C123',
          ts: '1234567890.123456',
        }),
      })

      const blocks: Block[] = [
        section({ text: mrkdwn('*Hello*') }),
        divider(),
      ]

      const result = await client.chat.postMessage({
        channel: 'C123',
        text: 'Hello (fallback)',
        blocks,
      })

      expect(result.ok).toBe(true)

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.blocks).toBeDefined()
      expect(body.blocks.length).toBe(2)
    })

    it('should post message with attachments', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, ts: '123' }),
      })

      const result = await client.chat.postMessage({
        channel: 'C123',
        text: 'Message with attachment',
        attachments: [
          {
            color: '#36a64f',
            title: 'Attachment Title',
            text: 'Attachment text',
          },
        ],
      })

      expect(result.ok).toBe(true)
    })

    it('should support thread_ts for replies', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, ts: '123' }),
      })

      await client.chat.postMessage({
        channel: 'C123',
        text: 'Thread reply',
        thread_ts: '1234567890.123456',
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.thread_ts).toBe('1234567890.123456')
    })

    it('should support reply_broadcast', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, ts: '123' }),
      })

      await client.chat.postMessage({
        channel: 'C123',
        text: 'Broadcast reply',
        thread_ts: '1234567890.123456',
        reply_broadcast: true,
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.reply_broadcast).toBe(true)
    })

    it('should support unfurl options', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, ts: '123' }),
      })

      await client.chat.postMessage({
        channel: 'C123',
        text: 'Check https://example.com',
        unfurl_links: true,
        unfurl_media: false,
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.unfurl_links).toBe(true)
      expect(body.unfurl_media).toBe(false)
    })

    it('should support as_user and username', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, ts: '123' }),
      })

      await client.chat.postMessage({
        channel: 'C123',
        text: 'Custom bot message',
        username: 'custom-bot',
        icon_emoji: ':robot_face:',
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.username).toBe('custom-bot')
      expect(body.icon_emoji).toBe(':robot_face:')
    })

    it('should support mrkdwn option', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, ts: '123' }),
      })

      await client.chat.postMessage({
        channel: 'C123',
        text: '*bold* text',
        mrkdwn: true,
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.mrkdwn).toBe(true)
    })

    it('should support metadata', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, ts: '123' }),
      })

      await client.chat.postMessage({
        channel: 'C123',
        text: 'With metadata',
        metadata: {
          event_type: 'order_placed',
          event_payload: { order_id: '12345' },
        },
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.metadata).toBeDefined()
      expect(body.metadata.event_type).toBe('order_placed')
    })
  })

  describe('chat.update', () => {
    it('should update a message', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          channel: 'C123',
          ts: '1234567890.123456',
          text: 'Updated message',
        }),
      })

      const result = await client.chat.update({
        channel: 'C123',
        ts: '1234567890.123456',
        text: 'Updated message',
      })

      expect(result.ok).toBe(true)
      expect(result.text).toBe('Updated message')
    })

    it('should update message with blocks', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, ts: '123' }),
      })

      await client.chat.update({
        channel: 'C123',
        ts: '1234567890.123456',
        blocks: [section({ text: mrkdwn('*Updated*') })],
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.blocks).toBeDefined()
    })

    it('should support as_user option', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, ts: '123' }),
      })

      await client.chat.update({
        channel: 'C123',
        ts: '1234567890.123456',
        text: 'Updated',
        as_user: true,
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.as_user).toBe(true)
    })
  })

  describe('chat.delete', () => {
    it('should delete a message', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          channel: 'C123',
          ts: '1234567890.123456',
        }),
      })

      const result = await client.chat.delete({
        channel: 'C123',
        ts: '1234567890.123456',
      })

      expect(result.ok).toBe(true)
      expect(result.channel).toBe('C123')
      expect(result.ts).toBe('1234567890.123456')
    })

    it('should support as_user option', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true }),
      })

      await client.chat.delete({
        channel: 'C123',
        ts: '1234567890.123456',
        as_user: true,
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.as_user).toBe(true)
    })
  })
})

// ============================================================================
// CONVERSATIONS API TESTS
// ============================================================================

describe('conversations API', () => {
  let client: WebClient
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    client = new WebClient('xoxb-test-token')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('conversations.list', () => {
    it('should list channels', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          channels: [
            { id: 'C123', name: 'general', is_channel: true },
            { id: 'C456', name: 'random', is_channel: true },
          ],
          response_metadata: {
            next_cursor: '',
          },
        }),
      })

      const result = await client.conversations.list({})

      expect(result.ok).toBe(true)
      expect(result.channels?.length).toBe(2)
      expect(result.channels?.[0].name).toBe('general')
    })

    it('should support types filter', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, channels: [] }),
      })

      await client.conversations.list({
        types: 'public_channel,private_channel',
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      expect(fetchCall[0]).toContain('types=public_channel')
    })

    it('should support pagination', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          channels: [{ id: 'C789', name: 'dev' }],
          response_metadata: {
            next_cursor: 'cursor-abc',
          },
        }),
      })

      const result = await client.conversations.list({
        limit: 10,
        cursor: 'cursor-xyz',
      })

      expect(result.response_metadata?.next_cursor).toBe('cursor-abc')
    })

    it('should support exclude_archived filter', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, channels: [] }),
      })

      await client.conversations.list({
        exclude_archived: true,
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      expect(fetchCall[0]).toContain('exclude_archived=true')
    })
  })

  describe('conversations.history', () => {
    it('should get channel history', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          messages: [
            { type: 'message', text: 'Hello', ts: '123', user: 'U123' },
            { type: 'message', text: 'World', ts: '124', user: 'U456' },
          ],
          has_more: false,
        }),
      })

      const result = await client.conversations.history({
        channel: 'C123',
      })

      expect(result.ok).toBe(true)
      expect(result.messages?.length).toBe(2)
      expect(result.messages?.[0].text).toBe('Hello')
    })

    it('should support pagination with cursor', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          messages: [],
          has_more: true,
          response_metadata: {
            next_cursor: 'next-cursor',
          },
        }),
      })

      const result = await client.conversations.history({
        channel: 'C123',
        cursor: 'prev-cursor',
        limit: 100,
      })

      expect(result.has_more).toBe(true)
      expect(result.response_metadata?.next_cursor).toBe('next-cursor')
    })

    it('should support time range filters', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, messages: [] }),
      })

      await client.conversations.history({
        channel: 'C123',
        oldest: '1234567890.000000',
        latest: '1234567899.999999',
        inclusive: true,
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      expect(fetchCall[0]).toContain('oldest=')
      expect(fetchCall[0]).toContain('latest=')
      expect(fetchCall[0]).toContain('inclusive=true')
    })

    it('should support include_all_metadata', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, messages: [] }),
      })

      await client.conversations.history({
        channel: 'C123',
        include_all_metadata: true,
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      expect(fetchCall[0]).toContain('include_all_metadata=true')
    })
  })

  describe('conversations.info', () => {
    it('should get channel info', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          channel: {
            id: 'C123',
            name: 'general',
            is_channel: true,
            is_member: true,
            topic: { value: 'General discussion' },
            purpose: { value: 'For general chat' },
          },
        }),
      })

      const result = await client.conversations.info({
        channel: 'C123',
      })

      expect(result.ok).toBe(true)
      expect(result.channel?.name).toBe('general')
      expect(result.channel?.topic?.value).toBe('General discussion')
    })
  })

  describe('conversations.join', () => {
    it('should join a channel', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          channel: { id: 'C123', name: 'general' },
        }),
      })

      const result = await client.conversations.join({
        channel: 'C123',
      })

      expect(result.ok).toBe(true)
      expect(result.channel?.id).toBe('C123')
    })
  })

  describe('conversations.leave', () => {
    it('should leave a channel', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true }),
      })

      const result = await client.conversations.leave({
        channel: 'C123',
      })

      expect(result.ok).toBe(true)
    })
  })
})

// ============================================================================
// USERS API TESTS
// ============================================================================

describe('users API', () => {
  let client: WebClient
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    client = new WebClient('xoxb-test-token')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('users.list', () => {
    it('should list users', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          members: [
            {
              id: 'U123',
              name: 'john',
              real_name: 'John Doe',
              is_admin: false,
              is_bot: false,
            },
            {
              id: 'U456',
              name: 'jane',
              real_name: 'Jane Doe',
              is_admin: true,
              is_bot: false,
            },
          ],
          response_metadata: {
            next_cursor: '',
          },
        }),
      })

      const result = await client.users.list({})

      expect(result.ok).toBe(true)
      expect(result.members?.length).toBe(2)
      expect(result.members?.[0].real_name).toBe('John Doe')
    })

    it('should support pagination', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          members: [],
          response_metadata: {
            next_cursor: 'cursor-next',
          },
        }),
      })

      const result = await client.users.list({
        cursor: 'cursor-prev',
        limit: 50,
      })

      expect(result.response_metadata?.next_cursor).toBe('cursor-next')
    })

    it('should support team_id filter', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, members: [] }),
      })

      await client.users.list({
        team_id: 'T123',
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      expect(fetchCall[0]).toContain('team_id=T123')
    })

    it('should support include_locale option', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, members: [] }),
      })

      await client.users.list({
        include_locale: true,
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      expect(fetchCall[0]).toContain('include_locale=true')
    })
  })

  describe('users.info', () => {
    it('should get user info', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          user: {
            id: 'U123',
            name: 'john',
            real_name: 'John Doe',
            is_admin: false,
            is_bot: false,
            profile: {
              email: 'john@example.com',
              display_name: 'John',
              image_48: 'https://example.com/avatar.png',
            },
          },
        }),
      })

      const result = await client.users.info({
        user: 'U123',
      })

      expect(result.ok).toBe(true)
      expect(result.user?.real_name).toBe('John Doe')
      expect(result.user?.profile?.email).toBe('john@example.com')
    })

    it('should support include_locale option', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          user: { id: 'U123', locale: 'en-US' },
        }),
      })

      const result = await client.users.info({
        user: 'U123',
        include_locale: true,
      })

      expect(result.user?.locale).toBe('en-US')
    })
  })

  describe('users.lookupByEmail', () => {
    it('should lookup user by email', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          user: {
            id: 'U123',
            name: 'john',
            profile: { email: 'john@example.com' },
          },
        }),
      })

      const result = await client.users.lookupByEmail({
        email: 'john@example.com',
      })

      expect(result.ok).toBe(true)
      expect(result.user?.id).toBe('U123')
    })
  })
})

// ============================================================================
// BLOCK KIT BUILDER TESTS
// ============================================================================

describe('Block Kit Builder', () => {
  describe('Blocks class', () => {
    it('should build array of blocks', () => {
      const blocks = new Blocks()
        .section({ text: mrkdwn('Hello') })
        .divider()
        .section({ text: plainText('World') })
        .build()

      expect(blocks.length).toBe(3)
      expect(blocks[0].type).toBe('section')
      expect(blocks[1].type).toBe('divider')
      expect(blocks[2].type).toBe('section')
    })

    it('should support header blocks', () => {
      const blocks = new Blocks()
        .header({ text: plainText('My Header') })
        .build()

      expect(blocks[0].type).toBe('header')
    })

    it('should support context blocks', () => {
      const blocks = new Blocks()
        .context({
          elements: [
            mrkdwn('*Author:* John'),
            mrkdwn('*Date:* Today'),
          ],
        })
        .build()

      expect(blocks[0].type).toBe('context')
    })

    it('should support actions blocks', () => {
      const blocks = new Blocks()
        .actions({
          elements: [
            button({ text: plainText('Click'), action_id: 'btn1' }),
          ],
        })
        .build()

      expect(blocks[0].type).toBe('actions')
    })

    it('should support image blocks', () => {
      const blocks = new Blocks()
        .image({
          image_url: 'https://example.com/img.png',
          alt_text: 'An image',
        })
        .build()

      expect(blocks[0].type).toBe('image')
    })

    it('should support input blocks', () => {
      const blocks = new Blocks()
        .input({
          label: plainText('Name'),
          element: textInput({ action_id: 'name-input' }),
        })
        .build()

      expect(blocks[0].type).toBe('input')
    })
  })

  describe('section helper', () => {
    it('should create section with text', () => {
      const block = section({ text: mrkdwn('*Bold* text') })
      expect(block.type).toBe('section')
      expect(block.text?.type).toBe('mrkdwn')
    })

    it('should create section with accessory', () => {
      const block = section({
        text: mrkdwn('Text'),
        accessory: button({ text: plainText('Click'), action_id: 'btn' }),
      })
      expect(block.accessory?.type).toBe('button')
    })

    it('should create section with fields', () => {
      const block = section({
        fields: [
          mrkdwn('*Field 1*'),
          mrkdwn('*Field 2*'),
        ],
      })
      expect(block.fields?.length).toBe(2)
    })

    it('should support block_id', () => {
      const block = section({
        text: plainText('Text'),
        block_id: 'my-section',
      })
      expect(block.block_id).toBe('my-section')
    })
  })

  describe('divider helper', () => {
    it('should create divider block', () => {
      const block = divider()
      expect(block.type).toBe('divider')
    })

    it('should support block_id', () => {
      const block = divider('my-divider')
      expect(block.block_id).toBe('my-divider')
    })
  })

  describe('header helper', () => {
    it('should create header block', () => {
      const block = header({ text: plainText('Header') })
      expect(block.type).toBe('header')
      expect(block.text.text).toBe('Header')
    })
  })

  describe('context helper', () => {
    it('should create context block with mixed elements', () => {
      const block = context({
        elements: [
          mrkdwn('Markdown'),
          plainText('Plain'),
        ],
      })
      expect(block.type).toBe('context')
      expect(block.elements.length).toBe(2)
    })
  })

  describe('actions helper', () => {
    it('should create actions block with multiple elements', () => {
      const block = actions({
        elements: [
          button({ text: plainText('Btn 1'), action_id: 'btn1' }),
          button({ text: plainText('Btn 2'), action_id: 'btn2' }),
        ],
      })
      expect(block.type).toBe('actions')
      expect(block.elements.length).toBe(2)
    })
  })

  describe('image helper', () => {
    it('should create image block', () => {
      const block = image({
        image_url: 'https://example.com/img.png',
        alt_text: 'Description',
      })
      expect(block.type).toBe('image')
      expect(block.image_url).toBe('https://example.com/img.png')
      expect(block.alt_text).toBe('Description')
    })

    it('should support title', () => {
      const block = image({
        image_url: 'https://example.com/img.png',
        alt_text: 'Description',
        title: plainText('Image Title'),
      })
      expect(block.title?.text).toBe('Image Title')
    })
  })

  describe('input helper', () => {
    it('should create input block', () => {
      const block = input({
        label: plainText('Email'),
        element: textInput({ action_id: 'email-input' }),
      })
      expect(block.type).toBe('input')
      expect(block.label.text).toBe('Email')
    })

    it('should support optional flag', () => {
      const block = input({
        label: plainText('Optional Field'),
        element: textInput({ action_id: 'optional-input' }),
        optional: true,
      })
      expect(block.optional).toBe(true)
    })

    it('should support hint', () => {
      const block = input({
        label: plainText('Password'),
        element: textInput({ action_id: 'password-input' }),
        hint: plainText('Must be at least 8 characters'),
      })
      expect(block.hint?.text).toBe('Must be at least 8 characters')
    })
  })

  describe('text objects', () => {
    it('should create plain text object', () => {
      const text = plainText('Hello')
      expect(text.type).toBe('plain_text')
      expect(text.text).toBe('Hello')
    })

    it('should support emoji in plain text', () => {
      const text = plainText('Hello :wave:', true)
      expect(text.emoji).toBe(true)
    })

    it('should create mrkdwn text object', () => {
      const text = mrkdwn('*Bold* and _italic_')
      expect(text.type).toBe('mrkdwn')
      expect(text.text).toBe('*Bold* and _italic_')
    })

    it('should support verbatim in mrkdwn', () => {
      const text = mrkdwn('<https://example.com|Link>', true)
      expect(text.verbatim).toBe(true)
    })
  })

  describe('interactive elements', () => {
    describe('button', () => {
      it('should create button with text and action_id', () => {
        const btn = button({
          text: plainText('Click Me'),
          action_id: 'button_click',
        })
        expect(btn.type).toBe('button')
        expect(btn.action_id).toBe('button_click')
      })

      it('should support url for link buttons', () => {
        const btn = button({
          text: plainText('Visit'),
          action_id: 'link_btn',
          url: 'https://example.com',
        })
        expect(btn.url).toBe('https://example.com')
      })

      it('should support value', () => {
        const btn = button({
          text: plainText('Submit'),
          action_id: 'submit',
          value: 'form-123',
        })
        expect(btn.value).toBe('form-123')
      })

      it('should support style', () => {
        const primaryBtn = button({
          text: plainText('Primary'),
          action_id: 'primary',
          style: 'primary',
        })
        expect(primaryBtn.style).toBe('primary')

        const dangerBtn = button({
          text: plainText('Danger'),
          action_id: 'danger',
          style: 'danger',
        })
        expect(dangerBtn.style).toBe('danger')
      })

      it('should support confirm dialog', () => {
        const btn = button({
          text: plainText('Delete'),
          action_id: 'delete',
          confirm: {
            title: plainText('Confirm'),
            text: mrkdwn('Are you sure?'),
            confirm: plainText('Yes'),
            deny: plainText('No'),
          },
        })
        expect(btn.confirm).toBeDefined()
        expect(btn.confirm?.title?.text).toBe('Confirm')
      })
    })

    describe('staticSelect', () => {
      it('should create select with options', () => {
        const select = staticSelect({
          placeholder: plainText('Select an option'),
          action_id: 'select_action',
          options: [
            option({ text: plainText('Option 1'), value: 'opt1' }),
            option({ text: plainText('Option 2'), value: 'opt2' }),
          ],
        })
        expect(select.type).toBe('static_select')
        expect(select.options?.length).toBe(2)
      })

      it('should support initial_option', () => {
        const select = staticSelect({
          placeholder: plainText('Select'),
          action_id: 'select',
          options: [
            option({ text: plainText('A'), value: 'a' }),
            option({ text: plainText('B'), value: 'b' }),
          ],
          initial_option: option({ text: plainText('A'), value: 'a' }),
        })
        expect(select.initial_option?.value).toBe('a')
      })

      it('should support option groups', () => {
        const select = staticSelect({
          placeholder: plainText('Select'),
          action_id: 'select',
          option_groups: [
            {
              label: plainText('Group 1'),
              options: [
                option({ text: plainText('A'), value: 'a' }),
              ],
            },
          ],
        })
        expect(select.option_groups?.length).toBe(1)
      })
    })

    describe('option', () => {
      it('should create option object', () => {
        const opt = option({
          text: plainText('My Option'),
          value: 'my-value',
        })
        expect(opt.text.text).toBe('My Option')
        expect(opt.value).toBe('my-value')
      })

      it('should support description', () => {
        const opt = option({
          text: plainText('Option'),
          value: 'opt',
          description: plainText('This is a description'),
        })
        expect(opt.description?.text).toBe('This is a description')
      })

      it('should support url for overflow menu', () => {
        const opt = option({
          text: plainText('Visit'),
          value: 'visit',
          url: 'https://example.com',
        })
        expect(opt.url).toBe('https://example.com')
      })
    })

    describe('overflow', () => {
      it('should create overflow menu', () => {
        const menu = overflow({
          action_id: 'overflow_menu',
          options: [
            option({ text: plainText('Edit'), value: 'edit' }),
            option({ text: plainText('Delete'), value: 'delete' }),
          ],
        })
        expect(menu.type).toBe('overflow')
        expect(menu.options.length).toBe(2)
      })
    })

    describe('datePicker', () => {
      it('should create date picker', () => {
        const picker = datePicker({
          action_id: 'date_pick',
          placeholder: plainText('Select date'),
        })
        expect(picker.type).toBe('datepicker')
      })

      it('should support initial_date', () => {
        const picker = datePicker({
          action_id: 'date_pick',
          initial_date: '2025-01-15',
        })
        expect(picker.initial_date).toBe('2025-01-15')
      })
    })

    describe('timePicker', () => {
      it('should create time picker', () => {
        const picker = timePicker({
          action_id: 'time_pick',
          placeholder: plainText('Select time'),
        })
        expect(picker.type).toBe('timepicker')
      })

      it('should support initial_time', () => {
        const picker = timePicker({
          action_id: 'time_pick',
          initial_time: '14:30',
        })
        expect(picker.initial_time).toBe('14:30')
      })
    })

    describe('textInput', () => {
      it('should create plain text input', () => {
        const input = textInput({
          action_id: 'text_input',
        })
        expect(input.type).toBe('plain_text_input')
      })

      it('should support placeholder', () => {
        const input = textInput({
          action_id: 'text_input',
          placeholder: plainText('Enter text...'),
        })
        expect(input.placeholder?.text).toBe('Enter text...')
      })

      it('should support initial_value', () => {
        const input = textInput({
          action_id: 'text_input',
          initial_value: 'Default text',
        })
        expect(input.initial_value).toBe('Default text')
      })

      it('should support multiline', () => {
        const input = textInput({
          action_id: 'text_input',
          multiline: true,
        })
        expect(input.multiline).toBe(true)
      })

      it('should support min/max length', () => {
        const input = textInput({
          action_id: 'text_input',
          min_length: 5,
          max_length: 100,
        })
        expect(input.min_length).toBe(5)
        expect(input.max_length).toBe(100)
      })
    })
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('SlackError', () => {
  it('should create error with code', () => {
    const error = new SlackError('channel_not_found')
    expect(error.code).toBe('channel_not_found')
    expect(error.message).toContain('channel_not_found')
  })

  it('should include response data if provided', () => {
    const error = new SlackError('invalid_auth', {
      response_metadata: { messages: ['Invalid token'] },
    })
    expect(error.data?.response_metadata).toBeDefined()
  })

  it('should have isSlackError property', () => {
    const error = new SlackError('some_error')
    expect(error.isSlackError).toBe(true)
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

  it('should work with realistic message posting scenario', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        channel: 'C123',
        ts: '1234567890.123456',
      }),
    })

    const client = new WebClient('xoxb-test-token')

    // Post a message with blocks
    const result = await client.chat.postMessage({
      channel: 'C123',
      text: 'New order received', // Fallback
      blocks: new Blocks()
        .header({ text: plainText('New Order #12345') })
        .section({
          fields: [
            mrkdwn('*Customer:*\nJohn Doe'),
            mrkdwn('*Amount:*\n$99.99'),
          ],
        })
        .divider()
        .actions({
          elements: [
            button({
              text: plainText('Approve'),
              action_id: 'approve_order',
              style: 'primary',
            }),
            button({
              text: plainText('Reject'),
              action_id: 'reject_order',
              style: 'danger',
            }),
          ],
        })
        .build(),
    })

    expect(result.ok).toBe(true)
    expect(result.ts).toBeDefined()
  })

  it('should work with pagination for fetching all users', async () => {
    let callCount = 0

    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ok: true,
            members: [{ id: 'U1', name: 'user1' }],
            response_metadata: { next_cursor: 'cursor-2' },
          }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          ok: true,
          members: [{ id: 'U2', name: 'user2' }],
          response_metadata: { next_cursor: '' },
        }),
      })
    })

    const client = new WebClient('xoxb-test-token')

    // First page
    const page1 = await client.users.list({})
    expect(page1.members?.length).toBe(1)
    expect(page1.response_metadata?.next_cursor).toBe('cursor-2')

    // Second page
    const page2 = await client.users.list({
      cursor: page1.response_metadata?.next_cursor,
    })
    expect(page2.members?.length).toBe(1)
    expect(page2.response_metadata?.next_cursor).toBe('')
  })

  it('should work with channel history for chat bot', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          messages: [
            { type: 'message', text: 'Hello bot', ts: '123', user: 'U123' },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          ts: '124',
        }),
      })

    const client = new WebClient('xoxb-test-token')

    // Get recent messages
    const history = await client.conversations.history({
      channel: 'C123',
      limit: 10,
    })

    // Respond to the last message
    if (history.messages && history.messages.length > 0) {
      await client.chat.postMessage({
        channel: 'C123',
        text: 'Hello human!',
        thread_ts: history.messages[0].ts,
      })
    }

    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
  })
})

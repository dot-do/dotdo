/**
 * @dotdo/slack/messages - Message API Tests
 *
 * Comprehensive tests for the Slack message posting API:
 * - chat.postMessage
 * - chat.postEphemeral
 * - chat.update
 * - chat.delete
 * - Thread replies
 * - Block Kit support
 * - mrkdwn formatting
 *
 * @see https://api.slack.com/methods/chat.postMessage
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  SlackMessages,
  createSlackMessages,
  MessageBuilder,
  message,
  SlackMessageError,
  // mrkdwn helpers
  bold,
  italic,
  strike,
  code,
  codeBlock,
  blockquote,
  link,
  mention,
  channel,
  here,
  atChannel,
  everyone,
  date,
  emoji,
  numberedList,
  bulletList,
  escape,
  type MessageRef,
  type PostMessageOptions,
} from '../messages'

import {
  section,
  divider,
  header,
  context,
  actions,
  button,
  plainText,
  mrkdwn,
  Blocks,
} from '../blocks'

// ============================================================================
// TEST SETUP
// ============================================================================

function createMockFetch(responses: Array<{ ok: boolean; [key: string]: unknown }>) {
  let callIndex = 0
  return vi.fn().mockImplementation(async () => ({
    ok: true,
    json: async () => {
      const response = responses[Math.min(callIndex++, responses.length - 1)]
      return response
    },
  }))
}

// ============================================================================
// SLACK MESSAGES CLIENT TESTS
// ============================================================================

describe('SlackMessages', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('construction', () => {
    it('should create client with token', () => {
      globalThis.fetch = vi.fn()
      const messages = new SlackMessages('xoxb-test-token')
      expect(messages).toBeDefined()
    })

    it('should create client with options', () => {
      globalThis.fetch = vi.fn()
      const messages = new SlackMessages('xoxb-test-token', {
        baseUrl: 'https://custom.slack.com/api',
        timeout: 60000,
        retry: { attempts: 5, delay: 500 },
      })
      expect(messages).toBeDefined()
    })

    it('should use factory function', () => {
      globalThis.fetch = vi.fn()
      const messages = createSlackMessages('xoxb-test-token')
      expect(messages).toBeInstanceOf(SlackMessages)
    })
  })

  describe('post', () => {
    it('should post simple text message', async () => {
      globalThis.fetch = createMockFetch([
        { ok: true, channel: 'C123', ts: '1234567890.123456' },
      ])

      const messages = new SlackMessages('xoxb-test-token')
      const result = await messages.post('#general', 'Hello, World!')

      expect(result.ok).toBe(true)
      expect(result.channel).toBe('C123')
      expect(result.ts).toBeDefined()

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://slack.com/api/chat.postMessage',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer xoxb-test-token',
            'Content-Type': 'application/json; charset=utf-8',
          }),
          body: JSON.stringify({
            channel: '#general',
            text: 'Hello, World!',
          }),
        })
      )
    })

    it('should post message with blocks', async () => {
      globalThis.fetch = createMockFetch([
        { ok: true, channel: 'C123', ts: '1234567890.123456' },
      ])

      const messages = new SlackMessages('xoxb-test-token')
      const blocks = new Blocks()
        .header({ text: plainText('Announcement') })
        .section({ text: mrkdwn('*Important* update!') })
        .divider()
        .actions({
          elements: [
            button({ text: plainText('Learn More'), action_id: 'learn_more' }),
          ],
        })
        .build()

      const result = await messages.post('#general', {
        text: 'Announcement: Important update!',
        blocks,
      })

      expect(result.ok).toBe(true)

      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(call[1].body)
      expect(body.blocks).toHaveLength(4)
      expect(body.blocks[0].type).toBe('header')
      expect(body.blocks[1].type).toBe('section')
      expect(body.blocks[2].type).toBe('divider')
      expect(body.blocks[3].type).toBe('actions')
    })

    it('should post message with attachments', async () => {
      globalThis.fetch = createMockFetch([
        { ok: true, channel: 'C123', ts: '1234567890.123456' },
      ])

      const messages = new SlackMessages('xoxb-test-token')
      const result = await messages.post('#general', {
        text: 'Status update',
        attachments: [
          {
            color: '#36a64f',
            title: 'Build Succeeded',
            text: 'Deployment complete',
            fields: [
              { title: 'Environment', value: 'Production', short: true },
              { title: 'Version', value: 'v1.2.3', short: true },
            ],
          },
        ],
      })

      expect(result.ok).toBe(true)

      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(call[1].body)
      expect(body.attachments).toHaveLength(1)
      expect(body.attachments[0].color).toBe('#36a64f')
    })

    it('should post message with custom bot identity', async () => {
      globalThis.fetch = createMockFetch([
        { ok: true, channel: 'C123', ts: '1234567890.123456' },
      ])

      const messages = new SlackMessages('xoxb-test-token')
      await messages.post('#general', {
        text: 'Hello!',
        username: 'CustomBot',
        icon_emoji: ':robot_face:',
      })

      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(call[1].body)
      expect(body.username).toBe('CustomBot')
      expect(body.icon_emoji).toBe(':robot_face:')
    })

    it('should handle unfurl options', async () => {
      globalThis.fetch = createMockFetch([
        { ok: true, channel: 'C123', ts: '1234567890.123456' },
      ])

      const messages = new SlackMessages('xoxb-test-token')
      await messages.post('#general', {
        text: 'Check out https://example.com',
        unfurl_links: false,
        unfurl_media: false,
      })

      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(call[1].body)
      expect(body.unfurl_links).toBe(false)
      expect(body.unfurl_media).toBe(false)
    })
  })

  describe('ephemeral', () => {
    it('should post ephemeral message', async () => {
      globalThis.fetch = createMockFetch([
        { ok: true, message_ts: '1234567890.123456' },
      ])

      const messages = new SlackMessages('xoxb-test-token')
      const result = await messages.ephemeral('#general', 'U1234567890', 'Only you can see this!')

      expect(result.ok).toBe(true)
      expect(result.message_ts).toBeDefined()

      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(call[0]).toBe('https://slack.com/api/chat.postEphemeral')

      const body = JSON.parse(call[1].body)
      expect(body.channel).toBe('#general')
      expect(body.user).toBe('U1234567890')
      expect(body.text).toBe('Only you can see this!')
    })

    it('should post ephemeral message with blocks', async () => {
      globalThis.fetch = createMockFetch([
        { ok: true, message_ts: '1234567890.123456' },
      ])

      const messages = new SlackMessages('xoxb-test-token')
      await messages.ephemeral('#general', 'U1234567890', {
        text: 'Fallback',
        blocks: [section({ text: mrkdwn('*Private* message') })],
      })

      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(call[1].body)
      expect(body.blocks).toHaveLength(1)
    })
  })

  describe('reply', () => {
    it('should reply to a message in thread', async () => {
      globalThis.fetch = createMockFetch([
        { ok: true, channel: 'C123', ts: '1234567890.123456' },
      ])

      const messages = new SlackMessages('xoxb-test-token')
      const originalRef: MessageRef = { channel: 'C123', ts: '1234567890.000001' }

      const result = await messages.reply(originalRef, 'Thread reply!')

      expect(result.ok).toBe(true)

      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(call[1].body)
      expect(body.channel).toBe('C123')
      expect(body.thread_ts).toBe('1234567890.000001')
      expect(body.text).toBe('Thread reply!')
    })

    it('should broadcast reply to channel', async () => {
      globalThis.fetch = createMockFetch([
        { ok: true, channel: 'C123', ts: '1234567890.123456' },
      ])

      const messages = new SlackMessages('xoxb-test-token')
      const originalRef: MessageRef = { channel: 'C123', ts: '1234567890.000001' }

      await messages.reply(originalRef, 'Broadcast reply!', true)

      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(call[1].body)
      expect(body.reply_broadcast).toBe(true)
    })
  })

  describe('update', () => {
    it('should update message text', async () => {
      globalThis.fetch = createMockFetch([
        { ok: true, channel: 'C123', ts: '1234567890.123456', text: 'Updated!' },
      ])

      const messages = new SlackMessages('xoxb-test-token')
      const ref: MessageRef = { channel: 'C123', ts: '1234567890.123456' }

      const result = await messages.update(ref, 'Updated!')

      expect(result.ok).toBe(true)

      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(call[0]).toBe('https://slack.com/api/chat.update')

      const body = JSON.parse(call[1].body)
      expect(body.channel).toBe('C123')
      expect(body.ts).toBe('1234567890.123456')
      expect(body.text).toBe('Updated!')
    })

    it('should update message with blocks', async () => {
      globalThis.fetch = createMockFetch([
        { ok: true, channel: 'C123', ts: '1234567890.123456' },
      ])

      const messages = new SlackMessages('xoxb-test-token')
      const ref: MessageRef = { channel: 'C123', ts: '1234567890.123456' }

      await messages.update(ref, {
        text: 'Updated',
        blocks: [section({ text: mrkdwn('*Updated* content') })],
      })

      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(call[1].body)
      expect(body.blocks).toHaveLength(1)
    })
  })

  describe('delete', () => {
    it('should delete a message', async () => {
      globalThis.fetch = createMockFetch([
        { ok: true, channel: 'C123', ts: '1234567890.123456' },
      ])

      const messages = new SlackMessages('xoxb-test-token')
      const ref: MessageRef = { channel: 'C123', ts: '1234567890.123456' }

      const result = await messages.delete(ref)

      expect(result.ok).toBe(true)

      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(call[0]).toBe('https://slack.com/api/chat.delete')

      const body = JSON.parse(call[1].body)
      expect(body.channel).toBe('C123')
      expect(body.ts).toBe('1234567890.123456')
    })
  })

  describe('schedule', () => {
    it('should schedule a message', async () => {
      globalThis.fetch = createMockFetch([
        { ok: true, channel: 'C123', scheduled_message_id: 'Q12345', post_at: 1700000000 },
      ])

      const messages = new SlackMessages('xoxb-test-token')
      const postAt = 1700000000

      const result = await messages.schedule('#general', postAt, 'Scheduled message!')

      expect(result.ok).toBe(true)
      expect(result.scheduled_message_id).toBe('Q12345')

      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(call[0]).toBe('https://slack.com/api/chat.scheduleMessage')

      const body = JSON.parse(call[1].body)
      expect(body.post_at).toBe(1700000000)
    })

    it('should schedule with Date object', async () => {
      globalThis.fetch = createMockFetch([
        { ok: true, channel: 'C123', scheduled_message_id: 'Q12345', post_at: 1700000000 },
      ])

      const messages = new SlackMessages('xoxb-test-token')
      const postAt = new Date('2023-11-14T16:00:00Z')

      await messages.schedule('#general', postAt, 'Scheduled message!')

      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(call[1].body)
      expect(body.post_at).toBe(Math.floor(postAt.getTime() / 1000))
    })
  })

  describe('convenience methods', () => {
    it('should post success message', async () => {
      globalThis.fetch = createMockFetch([
        { ok: true, channel: 'C123', ts: '1234567890.123456' },
      ])

      const messages = new SlackMessages('xoxb-test-token')
      await messages.success('#general', 'Success!', 'Operation completed')

      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(call[1].body)
      expect(body.attachments[0].color).toBe('#36a64f')
      expect(body.attachments[0].title).toBe('Success!')
    })

    it('should post warning message', async () => {
      globalThis.fetch = createMockFetch([
        { ok: true, channel: 'C123', ts: '1234567890.123456' },
      ])

      const messages = new SlackMessages('xoxb-test-token')
      await messages.warning('#general', 'Warning!', 'Something needs attention')

      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(call[1].body)
      expect(body.attachments[0].color).toBe('#ffcc00')
    })

    it('should post error message', async () => {
      globalThis.fetch = createMockFetch([
        { ok: true, channel: 'C123', ts: '1234567890.123456' },
      ])

      const messages = new SlackMessages('xoxb-test-token')
      await messages.error('#general', 'Error!', 'Something went wrong')

      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(call[1].body)
      expect(body.attachments[0].color).toBe('#dc3545')
    })

    it('should post info message', async () => {
      globalThis.fetch = createMockFetch([
        { ok: true, channel: 'C123', ts: '1234567890.123456' },
      ])

      const messages = new SlackMessages('xoxb-test-token')
      await messages.info('#general', 'Info', 'Here is some information')

      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(call[1].body)
      expect(body.attachments[0].color).toBe('#0d6efd')
    })
  })

  describe('error handling', () => {
    it('should throw SlackMessageError on API error', async () => {
      globalThis.fetch = createMockFetch([
        { ok: false, error: 'channel_not_found' },
      ])

      const messages = new SlackMessages('xoxb-test-token')

      await expect(messages.post('invalid', 'test')).rejects.toThrow(SlackMessageError)

      try {
        await messages.post('invalid', 'test')
      } catch (error) {
        expect(error).toBeInstanceOf(SlackMessageError)
        expect((error as SlackMessageError).code).toBe('channel_not_found')
      }
    })

    it('should retry on rate limit', async () => {
      let callCount = 0
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        callCount++
        if (callCount === 1) {
          return {
            ok: true,
            json: async () => ({ ok: false, error: 'rate_limited', retry_after: 1 }),
          }
        }
        return {
          ok: true,
          json: async () => ({ ok: true, channel: 'C123', ts: '1234567890.123456' }),
        }
      })

      const messages = new SlackMessages('xoxb-test-token', {
        retry: { attempts: 3, delay: 100 },
      })

      const result = await messages.post('#general', 'test')
      expect(result.ok).toBe(true)
      expect(callCount).toBe(2)
    })

    it('should not retry on client errors', async () => {
      globalThis.fetch = createMockFetch([
        { ok: false, error: 'invalid_auth' },
      ])

      const messages = new SlackMessages('xoxb-test-token', {
        retry: { attempts: 3 },
      })

      await expect(messages.post('#general', 'test')).rejects.toThrow(SlackMessageError)
      expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    })
  })
})

// ============================================================================
// MESSAGE BUILDER TESTS
// ============================================================================

describe('MessageBuilder', () => {
  it('should build simple message', () => {
    const options = message().text('Hello!').build()

    expect(options.text).toBe('Hello!')
  })

  it('should build message with blocks', () => {
    const options = message()
      .text('Fallback')
      .block(section({ text: mrkdwn('*Hello!*') }))
      .block(divider())
      .build()

    expect(options.text).toBe('Fallback')
    expect(options.blocks).toHaveLength(2)
  })

  it('should build message with multiple blocks at once', () => {
    const blocks = [
      section({ text: mrkdwn('Block 1') }),
      section({ text: mrkdwn('Block 2') }),
    ]

    const options = message().blocks(blocks).build()

    expect(options.blocks).toHaveLength(2)
  })

  it('should build message with thread', () => {
    const options = message()
      .text('Thread reply')
      .inThread('1234567890.123456')
      .build()

    expect(options.thread_ts).toBe('1234567890.123456')
  })

  it('should build message with broadcast', () => {
    const options = message()
      .text('Broadcast reply')
      .inThread('1234567890.123456')
      .broadcast()
      .build()

    expect(options.reply_broadcast).toBe(true)
  })

  it('should build message with unfurl options', () => {
    const options = message()
      .text('https://example.com')
      .noUnfurlLinks()
      .noUnfurlMedia()
      .build()

    expect(options.unfurl_links).toBe(false)
    expect(options.unfurl_media).toBe(false)
  })

  it('should build message with custom identity', () => {
    const options = message()
      .text('Hello!')
      .as('CustomBot')
      .withEmoji('robot_face')
      .build()

    expect(options.username).toBe('CustomBot')
    expect(options.icon_emoji).toBe(':robot_face:')
  })

  it('should build message with icon URL', () => {
    const options = message()
      .text('Hello!')
      .withIcon('https://example.com/icon.png')
      .build()

    expect(options.icon_url).toBe('https://example.com/icon.png')
  })

  it('should build message with metadata', () => {
    const options = message()
      .text('Hello!')
      .metadata('order_created', { order_id: '12345' })
      .build()

    expect(options.metadata?.event_type).toBe('order_created')
    expect(options.metadata?.event_payload).toEqual({ order_id: '12345' })
  })

  it('should handle emoji prefix', () => {
    const options = message()
      .text('Hello!')
      .withEmoji(':rocket:')
      .build()

    expect(options.icon_emoji).toBe(':rocket:')
  })
})

// ============================================================================
// MRKDWN FORMATTING TESTS
// ============================================================================

describe('mrkdwn formatting', () => {
  describe('text formatting', () => {
    it('should format bold text', () => {
      expect(bold('important')).toBe('*important*')
    })

    it('should format italic text', () => {
      expect(italic('emphasis')).toBe('_emphasis_')
    })

    it('should format strikethrough text', () => {
      expect(strike('deleted')).toBe('~deleted~')
    })

    it('should format inline code', () => {
      expect(code('const x = 1')).toBe('`const x = 1`')
    })

    it('should format code block', () => {
      expect(codeBlock('const x = 1')).toBe('```\nconst x = 1\n```')
    })

    it('should format code block with language', () => {
      expect(codeBlock('const x = 1', 'typescript')).toBe('```typescript\nconst x = 1\n```')
    })

    it('should format blockquote', () => {
      expect(blockquote('Quote line 1\nQuote line 2')).toBe('> Quote line 1\n> Quote line 2')
    })
  })

  describe('links and mentions', () => {
    it('should create link', () => {
      expect(link('https://example.com')).toBe('<https://example.com>')
    })

    it('should create link with text', () => {
      expect(link('https://example.com', 'Example')).toBe('<https://example.com|Example>')
    })

    it('should mention user', () => {
      expect(mention('U1234567890')).toBe('<@U1234567890>')
    })

    it('should mention channel', () => {
      expect(channel('C1234567890')).toBe('<#C1234567890>')
    })

    it('should create @here mention', () => {
      expect(here()).toBe('<!here>')
    })

    it('should create @channel mention', () => {
      expect(atChannel()).toBe('<!channel>')
    })

    it('should create @everyone mention', () => {
      expect(everyone()).toBe('<!everyone>')
    })
  })

  describe('dates and emojis', () => {
    it('should format date from timestamp', () => {
      const result = date(1700000000)
      expect(result).toMatch(/^<!date\^1700000000\^\{date_short\}\|.+>$/)
    })

    it('should format date from Date object', () => {
      const d = new Date('2023-11-14T16:00:00Z')
      const result = date(d)
      expect(result).toContain('<!date^')
    })

    it('should format date with custom format', () => {
      const result = date(1700000000, '{date_long}')
      expect(result).toContain('{date_long}')
    })

    it('should create emoji', () => {
      expect(emoji('rocket')).toBe(':rocket:')
    })
  })

  describe('lists', () => {
    it('should create numbered list', () => {
      const result = numberedList(['First', 'Second', 'Third'])
      expect(result).toBe('1. First\n2. Second\n3. Third')
    })

    it('should create bullet list', () => {
      const result = bulletList(['Item A', 'Item B', 'Item C'])
      expect(result).toBe('- Item A\n- Item B\n- Item C')
    })
  })

  describe('escaping', () => {
    it('should escape special characters', () => {
      expect(escape('<script>')).toBe('&lt;script&gt;')
      expect(escape('A & B')).toBe('A &amp; B')
    })
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('integration', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should post, reply, update, and delete message flow', async () => {
    let messageStore: { channel: string; ts: string; text: string }[] = []

    globalThis.fetch = vi.fn().mockImplementation(async (url: string, options: RequestInit) => {
      const body = JSON.parse(options.body as string)
      const method = url.split('/').pop()

      switch (method) {
        case 'chat.postMessage': {
          const ts = `${Date.now()}.${Math.random().toString().slice(2, 8)}`
          messageStore.push({
            channel: body.channel,
            ts,
            text: body.text,
          })
          return {
            ok: true,
            json: async () => ({ ok: true, channel: body.channel, ts }),
          }
        }
        case 'chat.update': {
          const msg = messageStore.find((m) => m.ts === body.ts)
          if (msg) {
            msg.text = body.text
          }
          return {
            ok: true,
            json: async () => ({
              ok: true,
              channel: body.channel,
              ts: body.ts,
              text: body.text,
            }),
          }
        }
        case 'chat.delete': {
          messageStore = messageStore.filter((m) => m.ts !== body.ts)
          return {
            ok: true,
            json: async () => ({ ok: true, channel: body.channel, ts: body.ts }),
          }
        }
        default:
          return {
            ok: true,
            json: async () => ({ ok: false, error: 'unknown_method' }),
          }
      }
    })

    const messages = new SlackMessages('xoxb-test-token')

    // Post original message
    const original = await messages.post('#general', 'Original message')
    expect(original.ok).toBe(true)
    expect(messageStore).toHaveLength(1)

    // Reply to the message
    const reply = await messages.reply(original, 'Thread reply')
    expect(reply.ok).toBe(true)
    expect(messageStore).toHaveLength(2)

    // Update the original
    await messages.update(original, 'Updated original')
    expect(messageStore[0].text).toBe('Updated original')

    // Delete the reply
    await messages.delete(reply)
    expect(messageStore).toHaveLength(1)
  })

  it('should build and post rich message', async () => {
    globalThis.fetch = createMockFetch([
      { ok: true, channel: 'C123', ts: '1234567890.123456' },
    ])

    const messages = new SlackMessages('xoxb-test-token')

    const options = message()
      .text('Deployment Status')
      .blocks([
        header({ text: plainText('Deployment Complete') }),
        section({
          text: mrkdwn(
            `${bold('Status:')} ${emoji('white_check_mark')} Success\n` +
            `${bold('Environment:')} Production\n` +
            `${bold('Version:')} v1.2.3`
          ),
        }),
        divider(),
        context({
          elements: [
            mrkdwn(`Deployed by ${mention('U1234567890')} at ${date(Date.now())}`),
          ],
        }),
        actions({
          elements: [
            button({
              text: plainText('View Logs'),
              action_id: 'view_logs',
              url: 'https://logs.example.com',
            }),
            button({
              text: plainText('Rollback'),
              action_id: 'rollback',
              style: 'danger',
            }),
          ],
        }),
      ])
      .as('DeployBot')
      .withEmoji('rocket')
      .build()

    const result = await messages.post('#deployments', options)
    expect(result.ok).toBe(true)

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse(call[1].body)

    expect(body.blocks).toHaveLength(5)
    expect(body.username).toBe('DeployBot')
    expect(body.icon_emoji).toBe(':rocket:')
  })
})

// ============================================================================
// WEBCLIENT CHAT API TESTS (RED Phase)
// These tests use the WebClient for comprehensive chat API coverage
// ============================================================================

import {
  WebClient,
  SlackError,
  type Block,
  staticSelect,
  multiStaticSelect,
  overflow,
  datePicker,
  timePicker,
  textInput,
  checkboxes,
  radioButtons,
  usersSelect,
  conversationsSelect,
  channelsSelect,
  option,
  image,
  input,
} from '../index'

// Extended types for methods not yet implemented
interface ChatPostEphemeralResponse {
  ok: boolean
  message_ts?: string
  error?: string
}

interface ChatScheduleMessageResponse {
  ok: boolean
  channel?: string
  scheduled_message_id?: string
  post_at?: number
  message?: {
    type: string
    text?: string
    ts?: string
    blocks?: Block[]
  }
  error?: string
}

interface ReactionsAddResponse {
  ok: boolean
  error?: string
}

interface ReactionsRemoveResponse {
  ok: boolean
  error?: string
}

interface ReactionsGetResponse {
  ok: boolean
  message?: {
    type: string
    text?: string
    ts: string
    reactions?: Array<{
      name: string
      count: number
      users: string[]
    }>
  }
  error?: string
}

interface ReactionsListResponse {
  ok: boolean
  items?: Array<{
    type: 'message' | 'file' | 'file_comment'
    channel?: string
    message?: {
      ts: string
      text?: string
      reactions?: Array<{
        name: string
        count: number
        users: string[]
      }>
    }
  }>
  response_metadata?: {
    next_cursor?: string
  }
  error?: string
}

// ============================================================================
// CHAT.POSTMESSAGE - VARIOUS FORMATS (RED Phase)
// ============================================================================

describe('WebClient chat.postMessage - Various Formats', () => {
  let client: WebClient
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    client = new WebClient('xoxb-test-token')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('basic text formats', () => {
    it('should post simple text message', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          channel: 'C1234567890',
          ts: '1234567890.123456',
          message: {
            type: 'message',
            text: 'Hello, World!',
            user: 'U1234567890',
            ts: '1234567890.123456',
          },
        }),
      })

      const result = await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Hello, World!',
      })

      expect(result.ok).toBe(true)
      expect(result.channel).toBe('C1234567890')
      expect(result.message?.text).toBe('Hello, World!')
    })

    it('should post message with mrkdwn formatting enabled', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          ts: '1234567890.123456',
        }),
      })

      await client.chat.postMessage({
        channel: 'C1234567890',
        text: '*bold* and _italic_ and ~strike~',
        mrkdwn: true,
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.mrkdwn).toBe(true)
    })

    it('should post message with link_names enabled', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          ts: '1234567890.123456',
        }),
      })

      await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Hey @here, check @channel for updates',
        link_names: true,
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.link_names).toBe(true)
    })

    it('should post message to channel by name (#channel)', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          channel: 'C1234567890',
          ts: '1234567890.123456',
        }),
      })

      await client.chat.postMessage({
        channel: '#general',
        text: 'Hello to general!',
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.channel).toBe('#general')
    })

    it('should post message with code block', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          ts: '1234567890.123456',
        }),
      })

      const codeText = '```javascript\nconst hello = "world";\nconsole.log(hello);\n```'
      await client.chat.postMessage({
        channel: 'C1234567890',
        text: codeText,
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.text).toContain('```')
    })

    it('should post message with parse mode "full"', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          ts: '1234567890.123456',
        }),
      })

      await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Message with full parsing',
        parse: 'full',
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.parse).toBe('full')
    })

    it('should post message with parse mode "none"', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          ts: '1234567890.123456',
        }),
      })

      await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Message with no parsing',
        parse: 'none',
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.parse).toBe('none')
    })
  })

  describe('message metadata', () => {
    it('should post message with event metadata', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          ts: '1234567890.123456',
        }),
      })

      await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Order confirmation',
        metadata: {
          event_type: 'order_placed',
          event_payload: {
            order_id: '12345',
            customer_id: 'CUST001',
            amount: 99.99,
            items: ['item1', 'item2'],
          },
        },
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.metadata.event_type).toBe('order_placed')
      expect(body.metadata.event_payload.order_id).toBe('12345')
    })
  })

  describe('unfurl controls', () => {
    it('should enable link unfurling', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          ts: '1234567890.123456',
        }),
      })

      await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Check this link: https://example.com',
        unfurl_links: true,
        unfurl_media: true,
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.unfurl_links).toBe(true)
      expect(body.unfurl_media).toBe(true)
    })

    it('should disable all unfurling', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          ts: '1234567890.123456',
        }),
      })

      await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'No previews here: https://example.com',
        unfurl_links: false,
        unfurl_media: false,
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.unfurl_links).toBe(false)
      expect(body.unfurl_media).toBe(false)
    })
  })

  describe('custom bot identity', () => {
    it('should post with custom username', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          ts: '1234567890.123456',
        }),
      })

      await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Hello from custom bot!',
        username: 'CustomBot',
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.username).toBe('CustomBot')
    })

    it('should post with custom icon emoji', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          ts: '1234567890.123456',
        }),
      })

      await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Deploy complete!',
        username: 'DeployBot',
        icon_emoji: ':rocket:',
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.icon_emoji).toBe(':rocket:')
    })

    it('should post with custom icon URL', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          ts: '1234567890.123456',
        }),
      })

      await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Hello!',
        username: 'CustomBot',
        icon_url: 'https://example.com/bot-avatar.png',
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.icon_url).toBe('https://example.com/bot-avatar.png')
    })
  })

  describe('attachments', () => {
    it('should post message with single attachment', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          ts: '1234567890.123456',
        }),
      })

      await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Message with attachment',
        attachments: [
          {
            color: '#36a64f',
            title: 'Deployment Successful',
            text: 'Your app has been deployed to production.',
          },
        ],
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.attachments).toHaveLength(1)
      expect(body.attachments[0].color).toBe('#36a64f')
    })

    it('should post message with multiple attachments', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          ts: '1234567890.123456',
        }),
      })

      await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Build results',
        attachments: [
          { color: '#36a64f', title: 'Tests', text: '245 passed' },
          { color: '#36a64f', title: 'Coverage', text: '92%' },
          { color: '#ffcc00', title: 'Warnings', text: '3 warnings found' },
        ],
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.attachments).toHaveLength(3)
    })

    it('should post attachment with fields', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          ts: '1234567890.123456',
        }),
      })

      await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Server status',
        attachments: [
          {
            title: 'Server Status',
            fields: [
              { title: 'CPU', value: '45%', short: true },
              { title: 'Memory', value: '78%', short: true },
              { title: 'Disk', value: '62%', short: true },
              { title: 'Network', value: 'Healthy', short: true },
            ],
          },
        ],
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.attachments[0].fields).toHaveLength(4)
      expect(body.attachments[0].fields[0].short).toBe(true)
    })

    it('should post attachment with images', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          ts: '1234567890.123456',
        }),
      })

      await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Performance metrics',
        attachments: [
          {
            title: 'Response Time Graph',
            image_url: 'https://example.com/chart.png',
            thumb_url: 'https://example.com/chart-thumb.png',
          },
        ],
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.attachments[0].image_url).toBe('https://example.com/chart.png')
    })
  })

  describe('error handling', () => {
    it('should handle channel_not_found error', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: false,
          error: 'channel_not_found',
        }),
      })

      await expect(
        client.chat.postMessage({
          channel: 'C_INVALID',
          text: 'test',
        })
      ).rejects.toThrow(SlackError)
    })

    it('should handle not_in_channel error', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: false,
          error: 'not_in_channel',
        }),
      })

      await expect(
        client.chat.postMessage({
          channel: 'C1234567890',
          text: 'test',
        })
      ).rejects.toThrow(SlackError)
    })

    it('should handle msg_too_long error', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: false,
          error: 'msg_too_long',
        }),
      })

      const longText = 'a'.repeat(50000)
      await expect(
        client.chat.postMessage({
          channel: 'C1234567890',
          text: longText,
        })
      ).rejects.toThrow(SlackError)
    })

    it('should handle no_text error', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: false,
          error: 'no_text',
        }),
      })

      await expect(
        client.chat.postMessage({
          channel: 'C1234567890',
        })
      ).rejects.toThrow(SlackError)
    })

    it('should handle is_archived error', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: false,
          error: 'is_archived',
        }),
      })

      await expect(
        client.chat.postMessage({
          channel: 'C_ARCHIVED',
          text: 'test',
        })
      ).rejects.toThrow(SlackError)
    })
  })
})

// ============================================================================
// CHAT.POSTEPHEMERAL (RED Phase)
// ============================================================================

describe('WebClient chat.postEphemeral', () => {
  let client: WebClient
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    client = new WebClient('xoxb-test-token')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should post ephemeral message to a user', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        message_ts: '1234567890.123456',
      }),
    })

    // @ts-expect-error - chat.postEphemeral not yet fully typed on WebClient
    const result = await client.chat.postEphemeral({
      channel: 'C1234567890',
      user: 'U1234567890',
      text: 'Only you can see this message!',
    }) as ChatPostEphemeralResponse

    expect(result.ok).toBe(true)
    expect(result.message_ts).toBe('1234567890.123456')
  })

  it('should post ephemeral message with blocks', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        message_ts: '1234567890.123456',
      }),
    })

    // @ts-expect-error - chat.postEphemeral not yet fully typed on WebClient
    await client.chat.postEphemeral({
      channel: 'C1234567890',
      user: 'U1234567890',
      text: 'Fallback text',
      blocks: [
        section({ text: mrkdwn('*Secret message* just for you!') }),
        actions({
          elements: [
            button({ text: plainText('Acknowledge'), action_id: 'ack' }),
          ],
        }),
      ],
    })

    const fetchCall = (globalThis.fetch as any).mock.calls[0]
    const body = JSON.parse(fetchCall[1].body)
    expect(body.blocks).toHaveLength(2)
    expect(body.user).toBe('U1234567890')
  })

  it('should post ephemeral message in a thread', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        message_ts: '1234567890.123457',
      }),
    })

    // @ts-expect-error - chat.postEphemeral not yet fully typed on WebClient
    await client.chat.postEphemeral({
      channel: 'C1234567890',
      user: 'U1234567890',
      text: 'Ephemeral in thread',
      thread_ts: '1234567890.123456',
    })

    const fetchCall = (globalThis.fetch as any).mock.calls[0]
    const body = JSON.parse(fetchCall[1].body)
    expect(body.thread_ts).toBe('1234567890.123456')
  })

  it('should post ephemeral message with custom identity', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        message_ts: '1234567890.123456',
      }),
    })

    // @ts-expect-error - chat.postEphemeral not yet fully typed on WebClient
    await client.chat.postEphemeral({
      channel: 'C1234567890',
      user: 'U1234567890',
      text: 'Custom bot message',
      username: 'SecretBot',
      icon_emoji: ':shushing_face:',
    })

    const fetchCall = (globalThis.fetch as any).mock.calls[0]
    const body = JSON.parse(fetchCall[1].body)
    expect(body.username).toBe('SecretBot')
    expect(body.icon_emoji).toBe(':shushing_face:')
  })

  it('should fail with user_not_found error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        error: 'user_not_found',
      }),
    })

    await expect(
      // @ts-expect-error - chat.postEphemeral not yet fully typed on WebClient
      client.chat.postEphemeral({
        channel: 'C1234567890',
        user: 'U_INVALID',
        text: 'test',
      })
    ).rejects.toThrow(SlackError)
  })

  it('should fail with user_not_in_channel error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        error: 'user_not_in_channel',
      }),
    })

    await expect(
      // @ts-expect-error - chat.postEphemeral not yet fully typed on WebClient
      client.chat.postEphemeral({
        channel: 'C1234567890',
        user: 'U_NOT_MEMBER',
        text: 'test',
      })
    ).rejects.toThrow(SlackError)
  })
})

// ============================================================================
// CHAT.UPDATE (RED Phase)
// ============================================================================

describe('WebClient chat.update', () => {
  let client: WebClient
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    client = new WebClient('xoxb-test-token')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should update message text', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        channel: 'C1234567890',
        ts: '1234567890.123456',
        text: 'Updated message text',
        message: {
          type: 'message',
          text: 'Updated message text',
          ts: '1234567890.123456',
        },
      }),
    })

    const result = await client.chat.update({
      channel: 'C1234567890',
      ts: '1234567890.123456',
      text: 'Updated message text',
    })

    expect(result.ok).toBe(true)
    expect(result.text).toBe('Updated message text')
  })

  it('should update message with blocks', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        channel: 'C1234567890',
        ts: '1234567890.123456',
      }),
    })

    await client.chat.update({
      channel: 'C1234567890',
      ts: '1234567890.123456',
      blocks: [
        section({ text: mrkdwn('*Updated* content with blocks') }),
        divider(),
        context({
          elements: [mrkdwn('Last updated: Now')],
        }),
      ],
    })

    const fetchCall = (globalThis.fetch as any).mock.calls[0]
    const body = JSON.parse(fetchCall[1].body)
    expect(body.blocks).toHaveLength(3)
  })

  it('should update message with attachments', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        channel: 'C1234567890',
        ts: '1234567890.123456',
      }),
    })

    await client.chat.update({
      channel: 'C1234567890',
      ts: '1234567890.123456',
      text: 'Updated with attachment',
      attachments: [
        {
          color: '#2eb886',
          title: 'Status Updated',
          text: 'Build completed successfully',
        },
      ],
    })

    const fetchCall = (globalThis.fetch as any).mock.calls[0]
    const body = JSON.parse(fetchCall[1].body)
    expect(body.attachments[0].color).toBe('#2eb886')
  })

  it('should update message metadata', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        ts: '1234567890.123456',
      }),
    })

    await client.chat.update({
      channel: 'C1234567890',
      ts: '1234567890.123456',
      text: 'Updated order status',
      metadata: {
        event_type: 'order_shipped',
        event_payload: {
          order_id: '12345',
          tracking_number: 'TRACK123',
        },
      },
    })

    const fetchCall = (globalThis.fetch as any).mock.calls[0]
    const body = JSON.parse(fetchCall[1].body)
    expect(body.metadata.event_type).toBe('order_shipped')
  })

  it('should support reply_broadcast when updating thread reply', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        ts: '1234567890.123456',
      }),
    })

    await client.chat.update({
      channel: 'C1234567890',
      ts: '1234567890.123456',
      text: 'Updated thread reply',
      reply_broadcast: true,
    })

    const fetchCall = (globalThis.fetch as any).mock.calls[0]
    const body = JSON.parse(fetchCall[1].body)
    expect(body.reply_broadcast).toBe(true)
  })

  it('should fail with message_not_found error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        error: 'message_not_found',
      }),
    })

    await expect(
      client.chat.update({
        channel: 'C1234567890',
        ts: '0000000000.000000',
        text: 'test',
      })
    ).rejects.toThrow(SlackError)
  })

  it('should fail with cant_update_message error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        error: 'cant_update_message',
      }),
    })

    await expect(
      client.chat.update({
        channel: 'C1234567890',
        ts: '1234567890.123456',
        text: 'Trying to update someone elses message',
      })
    ).rejects.toThrow(SlackError)
  })

  it('should fail with edit_window_closed error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        error: 'edit_window_closed',
      }),
    })

    await expect(
      client.chat.update({
        channel: 'C1234567890',
        ts: '1234567890.123456',
        text: 'test',
      })
    ).rejects.toThrow(SlackError)
  })
})

// ============================================================================
// CHAT.DELETE (RED Phase)
// ============================================================================

describe('WebClient chat.delete', () => {
  let client: WebClient
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    client = new WebClient('xoxb-test-token')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should delete a message', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        channel: 'C1234567890',
        ts: '1234567890.123456',
      }),
    })

    const result = await client.chat.delete({
      channel: 'C1234567890',
      ts: '1234567890.123456',
    })

    expect(result.ok).toBe(true)
    expect(result.channel).toBe('C1234567890')
    expect(result.ts).toBe('1234567890.123456')
  })

  it('should delete message as user when as_user is true', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        channel: 'C1234567890',
        ts: '1234567890.123456',
      }),
    })

    await client.chat.delete({
      channel: 'C1234567890',
      ts: '1234567890.123456',
      as_user: true,
    })

    const fetchCall = (globalThis.fetch as any).mock.calls[0]
    const body = JSON.parse(fetchCall[1].body)
    expect(body.as_user).toBe(true)
  })

  it('should fail with message_not_found error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        error: 'message_not_found',
      }),
    })

    await expect(
      client.chat.delete({
        channel: 'C1234567890',
        ts: '0000000000.000000',
      })
    ).rejects.toThrow(SlackError)
  })

  it('should fail with cant_delete_message error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        error: 'cant_delete_message',
      }),
    })

    await expect(
      client.chat.delete({
        channel: 'C1234567890',
        ts: '1234567890.123456',
      })
    ).rejects.toThrow(SlackError)
  })

  it('should fail with compliance_exports_prevent_deletion error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        error: 'compliance_exports_prevent_deletion',
      }),
    })

    await expect(
      client.chat.delete({
        channel: 'C1234567890',
        ts: '1234567890.123456',
      })
    ).rejects.toThrow(SlackError)
  })
})

// ============================================================================
// BLOCK KIT MESSAGES (RED Phase)
// ============================================================================

describe('Block Kit Messages', () => {
  let client: WebClient
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    client = new WebClient('xoxb-test-token')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('section blocks', () => {
    it('should post message with section text', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          ts: '1234567890.123456',
        }),
      })

      await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Fallback',
        blocks: [
          section({ text: mrkdwn('*Hello*, this is a _section_ block') }),
        ],
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.blocks[0].type).toBe('section')
      expect(body.blocks[0].text.type).toBe('mrkdwn')
    })

    it('should post message with section fields', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          ts: '1234567890.123456',
        }),
      })

      await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Fallback',
        blocks: [
          section({
            fields: [
              mrkdwn('*Type:*\nPaid Time Off'),
              mrkdwn('*When:*\nAug 10 - Aug 13'),
              mrkdwn('*Status:*\nApproved'),
              mrkdwn('*Approver:*\nFred'),
            ],
          }),
        ],
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.blocks[0].fields).toHaveLength(4)
    })

    it('should post message with section accessory button', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          ts: '1234567890.123456',
        }),
      })

      await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Fallback',
        blocks: [
          section({
            text: mrkdwn('Click the button to approve'),
            accessory: button({
              text: plainText('Approve'),
              action_id: 'approve_action',
              style: 'primary',
            }),
          }),
        ],
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.blocks[0].accessory.type).toBe('button')
      expect(body.blocks[0].accessory.style).toBe('primary')
    })
  })

  describe('header and divider blocks', () => {
    it('should post message with header block', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          ts: '1234567890.123456',
        }),
      })

      await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Fallback',
        blocks: [
          header({ text: plainText('Important Announcement') }),
        ],
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.blocks[0].type).toBe('header')
    })

    it('should post message with divider blocks', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          ts: '1234567890.123456',
        }),
      })

      await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Fallback',
        blocks: [
          section({ text: mrkdwn('First section') }),
          divider(),
          section({ text: mrkdwn('Second section') }),
        ],
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.blocks[1].type).toBe('divider')
    })
  })

  describe('context and image blocks', () => {
    it('should post message with context block', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          ts: '1234567890.123456',
        }),
      })

      await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Fallback',
        blocks: [
          context({
            elements: [
              mrkdwn('*Author:* John Doe'),
              mrkdwn('*Date:* January 12, 2026'),
            ],
          }),
        ],
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.blocks[0].type).toBe('context')
      expect(body.blocks[0].elements).toHaveLength(2)
    })

    it('should post message with image block', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          ts: '1234567890.123456',
        }),
      })

      await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Fallback',
        blocks: [
          image({
            image_url: 'https://example.com/large-image.png',
            alt_text: 'A beautiful landscape',
            title: plainText('Mountain View'),
          }),
        ],
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.blocks[0].type).toBe('image')
      expect(body.blocks[0].image_url).toBe('https://example.com/large-image.png')
    })
  })

  describe('actions blocks', () => {
    it('should post message with button actions', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          ts: '1234567890.123456',
        }),
      })

      await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Fallback',
        blocks: [
          actions({
            elements: [
              button({
                text: plainText('Approve'),
                action_id: 'approve',
                style: 'primary',
                value: 'approve_123',
              }),
              button({
                text: plainText('Deny'),
                action_id: 'deny',
                style: 'danger',
                value: 'deny_123',
              }),
            ],
          }),
        ],
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.blocks[0].type).toBe('actions')
      expect(body.blocks[0].elements).toHaveLength(2)
    })

    it('should post message with select menu', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          ts: '1234567890.123456',
        }),
      })

      await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Fallback',
        blocks: [
          actions({
            elements: [
              staticSelect({
                action_id: 'select_priority',
                placeholder: plainText('Choose priority'),
                options: [
                  option({ text: plainText('High'), value: 'high' }),
                  option({ text: plainText('Medium'), value: 'medium' }),
                  option({ text: plainText('Low'), value: 'low' }),
                ],
              }),
            ],
          }),
        ],
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.blocks[0].elements[0].type).toBe('static_select')
      expect(body.blocks[0].elements[0].options).toHaveLength(3)
    })

    it('should post message with multi-select', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          ts: '1234567890.123456',
        }),
      })

      await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Fallback',
        blocks: [
          actions({
            elements: [
              multiStaticSelect({
                action_id: 'select_tags',
                placeholder: plainText('Select tags'),
                options: [
                  option({ text: plainText('Bug'), value: 'bug' }),
                  option({ text: plainText('Feature'), value: 'feature' }),
                  option({ text: plainText('Enhancement'), value: 'enhancement' }),
                ],
                max_selected_items: 3,
              }),
            ],
          }),
        ],
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.blocks[0].elements[0].type).toBe('multi_static_select')
    })

    it('should post message with date and time pickers', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          ts: '1234567890.123456',
        }),
      })

      await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Fallback',
        blocks: [
          actions({
            elements: [
              datePicker({
                action_id: 'select_date',
                placeholder: plainText('Select a date'),
                initial_date: '2026-01-15',
              }),
              timePicker({
                action_id: 'select_time',
                placeholder: plainText('Select a time'),
                initial_time: '14:30',
              }),
            ],
          }),
        ],
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.blocks[0].elements[0].type).toBe('datepicker')
      expect(body.blocks[0].elements[1].type).toBe('timepicker')
    })

    it('should post message with overflow menu', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          ts: '1234567890.123456',
        }),
      })

      await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Fallback',
        blocks: [
          section({
            text: mrkdwn('Task item'),
            accessory: overflow({
              action_id: 'overflow_menu',
              options: [
                option({ text: plainText('Edit'), value: 'edit' }),
                option({ text: plainText('Delete'), value: 'delete' }),
                option({ text: plainText('Archive'), value: 'archive' }),
              ],
            }),
          }),
        ],
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.blocks[0].accessory.type).toBe('overflow')
    })

    it('should post message with user/channel/conversation selects', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          ts: '1234567890.123456',
        }),
      })

      await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Fallback',
        blocks: [
          actions({
            elements: [
              usersSelect({
                action_id: 'select_user',
                placeholder: plainText('Select a user'),
              }),
              conversationsSelect({
                action_id: 'select_conversation',
                placeholder: plainText('Select a conversation'),
              }),
              channelsSelect({
                action_id: 'select_channel',
                placeholder: plainText('Select a channel'),
              }),
            ],
          }),
        ],
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.blocks[0].elements[0].type).toBe('users_select')
      expect(body.blocks[0].elements[1].type).toBe('conversations_select')
      expect(body.blocks[0].elements[2].type).toBe('channels_select')
    })

    it('should post message with checkboxes and radio buttons', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          ts: '1234567890.123456',
        }),
      })

      await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Fallback',
        blocks: [
          actions({
            elements: [
              checkboxes({
                action_id: 'checkbox_action',
                options: [
                  option({ text: mrkdwn('*Option A*'), value: 'a' }),
                  option({ text: mrkdwn('*Option B*'), value: 'b' }),
                ],
              }),
              radioButtons({
                action_id: 'radio_action',
                options: [
                  option({ text: plainText('Choice 1'), value: '1' }),
                  option({ text: plainText('Choice 2'), value: '2' }),
                ],
              }),
            ],
          }),
        ],
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.blocks[0].elements[0].type).toBe('checkboxes')
      expect(body.blocks[0].elements[1].type).toBe('radio_buttons')
    })
  })

  describe('input blocks', () => {
    it('should post message with text input block', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          ts: '1234567890.123456',
        }),
      })

      await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Fallback',
        blocks: [
          input({
            label: plainText('Your Name'),
            element: textInput({
              action_id: 'name_input',
              placeholder: plainText('Enter your name'),
            }),
            hint: plainText('First and last name'),
          }),
        ],
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.blocks[0].type).toBe('input')
      expect(body.blocks[0].element.type).toBe('plain_text_input')
    })

    it('should post message with multiline input', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          ts: '1234567890.123456',
        }),
      })

      await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Fallback',
        blocks: [
          input({
            label: plainText('Description'),
            element: textInput({
              action_id: 'description_input',
              multiline: true,
              min_length: 10,
              max_length: 500,
            }),
            optional: true,
          }),
        ],
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.blocks[0].element.multiline).toBe(true)
      expect(body.blocks[0].optional).toBe(true)
    })
  })

  describe('complex multi-block messages', () => {
    it('should post a full dashboard notification', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          ts: '1234567890.123456',
        }),
      })

      const blocks = new Blocks()
        .header({ text: plainText('Weekly Sales Report') })
        .section({
          text: mrkdwn('Here is your weekly sales summary for *January 6 - January 12, 2026*'),
        })
        .divider()
        .section({
          fields: [
            mrkdwn('*Total Revenue:*\n$125,430'),
            mrkdwn('*Orders:*\n1,234'),
            mrkdwn('*Avg Order Value:*\n$101.65'),
            mrkdwn('*New Customers:*\n89'),
          ],
        })
        .divider()
        .context({
          elements: [
            mrkdwn(':chart_with_upwards_trend: Revenue up 12% from last week'),
          ],
        })
        .actions({
          elements: [
            button({
              text: plainText('View Full Report'),
              action_id: 'view_report',
              url: 'https://example.com/report',
            }),
            button({
              text: plainText('Download CSV'),
              action_id: 'download_csv',
              style: 'primary',
            }),
          ],
        })
        .build()

      await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Weekly Sales Report - Revenue: $125,430',
        blocks,
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.blocks).toHaveLength(7)
    })
  })
})

// ============================================================================
// THREAD REPLIES (RED Phase)
// ============================================================================

describe('Thread Replies', () => {
  let client: WebClient
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    client = new WebClient('xoxb-test-token')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should reply to a message in thread', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        channel: 'C1234567890',
        ts: '1234567890.123457',
        message: {
          type: 'message',
          text: 'This is a thread reply',
          ts: '1234567890.123457',
          thread_ts: '1234567890.123456',
        },
      }),
    })

    const result = await client.chat.postMessage({
      channel: 'C1234567890',
      text: 'This is a thread reply',
      thread_ts: '1234567890.123456',
    })

    expect(result.ok).toBe(true)
    const fetchCall = (globalThis.fetch as any).mock.calls[0]
    const body = JSON.parse(fetchCall[1].body)
    expect(body.thread_ts).toBe('1234567890.123456')
  })

  it('should reply with broadcast to channel', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        channel: 'C1234567890',
        ts: '1234567890.123457',
      }),
    })

    await client.chat.postMessage({
      channel: 'C1234567890',
      text: 'Important update (also posted to channel)',
      thread_ts: '1234567890.123456',
      reply_broadcast: true,
    })

    const fetchCall = (globalThis.fetch as any).mock.calls[0]
    const body = JSON.parse(fetchCall[1].body)
    expect(body.reply_broadcast).toBe(true)
  })

  it('should reply with blocks in thread', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        ts: '1234567890.123457',
      }),
    })

    await client.chat.postMessage({
      channel: 'C1234567890',
      text: 'Fallback',
      thread_ts: '1234567890.123456',
      blocks: [
        section({
          text: mrkdwn('Thread reply with *blocks*'),
        }),
        actions({
          elements: [
            button({
              text: plainText('Respond'),
              action_id: 'respond',
            }),
          ],
        }),
      ],
    })

    const fetchCall = (globalThis.fetch as any).mock.calls[0]
    const body = JSON.parse(fetchCall[1].body)
    expect(body.thread_ts).toBe('1234567890.123456')
    expect(body.blocks).toHaveLength(2)
  })

  it('should handle thread_not_found error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        error: 'thread_not_found',
      }),
    })

    await expect(
      client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Reply to non-existent thread',
        thread_ts: '0000000000.000000',
      })
    ).rejects.toThrow(SlackError)
  })
})

// ============================================================================
// REACTIONS (RED Phase)
// ============================================================================

describe('Reactions', () => {
  let client: WebClient
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    client = new WebClient('xoxb-test-token')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('reactions.add', () => {
    it('should add a reaction to a message', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
        }),
      })

      // @ts-expect-error - reactions.add not yet implemented
      const result = await client.reactions.add({
        channel: 'C1234567890',
        name: 'thumbsup',
        timestamp: '1234567890.123456',
      }) as ReactionsAddResponse

      expect(result.ok).toBe(true)

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.name).toBe('thumbsup')
      expect(body.timestamp).toBe('1234567890.123456')
    })

    it('should add emoji reaction with colons stripped', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
        }),
      })

      // @ts-expect-error - reactions.add not yet implemented
      await client.reactions.add({
        channel: 'C1234567890',
        name: ':rocket:',
        timestamp: '1234567890.123456',
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      // API expects name without colons
      expect(body.name).toBe('rocket')
    })

    it('should add custom emoji reaction', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
        }),
      })

      // @ts-expect-error - reactions.add not yet implemented
      await client.reactions.add({
        channel: 'C1234567890',
        name: 'custom_emoji',
        timestamp: '1234567890.123456',
      })

      expect(globalThis.fetch).toHaveBeenCalled()
    })

    it('should fail with invalid_name error for unknown emoji', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: false,
          error: 'invalid_name',
        }),
      })

      await expect(
        // @ts-expect-error - reactions.add not yet implemented
        client.reactions.add({
          channel: 'C1234567890',
          name: 'nonexistent_emoji_12345',
          timestamp: '1234567890.123456',
        })
      ).rejects.toThrow(SlackError)
    })

    it('should fail with already_reacted error', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: false,
          error: 'already_reacted',
        }),
      })

      await expect(
        // @ts-expect-error - reactions.add not yet implemented
        client.reactions.add({
          channel: 'C1234567890',
          name: 'thumbsup',
          timestamp: '1234567890.123456',
        })
      ).rejects.toThrow(SlackError)
    })

    it('should fail with message_not_found error', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: false,
          error: 'message_not_found',
        }),
      })

      await expect(
        // @ts-expect-error - reactions.add not yet implemented
        client.reactions.add({
          channel: 'C1234567890',
          name: 'thumbsup',
          timestamp: '0000000000.000000',
        })
      ).rejects.toThrow(SlackError)
    })

    it('should fail with too_many_reactions error', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: false,
          error: 'too_many_reactions',
        }),
      })

      await expect(
        // @ts-expect-error - reactions.add not yet implemented
        client.reactions.add({
          channel: 'C1234567890',
          name: 'emoji_24',
          timestamp: '1234567890.123456',
        })
      ).rejects.toThrow(SlackError)
    })
  })

  describe('reactions.remove', () => {
    it('should remove a reaction from a message', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
        }),
      })

      // @ts-expect-error - reactions.remove not yet implemented
      const result = await client.reactions.remove({
        channel: 'C1234567890',
        name: 'thumbsup',
        timestamp: '1234567890.123456',
      }) as ReactionsRemoveResponse

      expect(result.ok).toBe(true)
    })

    it('should fail with no_reaction error', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: false,
          error: 'no_reaction',
        }),
      })

      await expect(
        // @ts-expect-error - reactions.remove not yet implemented
        client.reactions.remove({
          channel: 'C1234567890',
          name: 'thumbsup',
          timestamp: '1234567890.123456',
        })
      ).rejects.toThrow(SlackError)
    })
  })

  describe('reactions.get', () => {
    it('should get reactions for a message', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          message: {
            type: 'message',
            text: 'Hello World',
            ts: '1234567890.123456',
            reactions: [
              { name: 'thumbsup', count: 3, users: ['U111', 'U222', 'U333'] },
              { name: 'heart', count: 2, users: ['U111', 'U444'] },
              { name: 'rocket', count: 1, users: ['U555'] },
            ],
          },
        }),
      })

      // @ts-expect-error - reactions.get not yet implemented
      const result = await client.reactions.get({
        channel: 'C1234567890',
        timestamp: '1234567890.123456',
        full: true,
      }) as ReactionsGetResponse

      expect(result.ok).toBe(true)
      expect(result.message?.reactions).toHaveLength(3)
      expect(result.message?.reactions?.[0].name).toBe('thumbsup')
      expect(result.message?.reactions?.[0].count).toBe(3)
    })

    it('should get reactions with full user list', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          message: {
            type: 'message',
            ts: '1234567890.123456',
            reactions: [
              { name: 'thumbsup', count: 50, users: Array(50).fill('U123') },
            ],
          },
        }),
      })

      // @ts-expect-error - reactions.get not yet implemented
      await client.reactions.get({
        channel: 'C1234567890',
        timestamp: '1234567890.123456',
        full: true,
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      expect(fetchCall[0]).toContain('full=true')
    })
  })

  describe('reactions.list', () => {
    it('should list items with reactions by user', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          items: [
            {
              type: 'message',
              channel: 'C1234567890',
              message: {
                ts: '1234567890.123456',
                text: 'Hello',
                reactions: [
                  { name: 'thumbsup', count: 1, users: ['U1234567890'] },
                ],
              },
            },
            {
              type: 'message',
              channel: 'C1234567890',
              message: {
                ts: '1234567890.123457',
                text: 'World',
                reactions: [
                  { name: 'heart', count: 1, users: ['U1234567890'] },
                ],
              },
            },
          ],
          response_metadata: {
            next_cursor: '',
          },
        }),
      })

      // @ts-expect-error - reactions.list not yet implemented
      const result = await client.reactions.list({
        user: 'U1234567890',
      }) as ReactionsListResponse

      expect(result.ok).toBe(true)
      expect(result.items).toHaveLength(2)
    })

    it('should support pagination', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          items: [
            {
              type: 'message',
              channel: 'C1234567890',
              message: { ts: '123', text: 'Test' },
            },
          ],
          response_metadata: {
            next_cursor: 'dXNlcjpVMDYxRkE1UEI=',
          },
        }),
      })

      // @ts-expect-error - reactions.list not yet implemented
      const result = await client.reactions.list({
        user: 'U1234567890',
        limit: 1,
      }) as ReactionsListResponse

      expect(result.response_metadata?.next_cursor).toBe('dXNlcjpVMDYxRkE1UEI=')
    })
  })
})

// ============================================================================
// SCHEDULED MESSAGES (RED Phase)
// ============================================================================

describe('Scheduled Messages', () => {
  let client: WebClient
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    client = new WebClient('xoxb-test-token')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('chat.scheduleMessage', () => {
    it('should schedule a message', async () => {
      const postAt = Math.floor(Date.now() / 1000) + 3600 // 1 hour from now

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          channel: 'C1234567890',
          scheduled_message_id: 'Q1234567890',
          post_at: postAt,
        }),
      })

      // @ts-expect-error - chat.scheduleMessage not yet implemented
      const result = await client.chat.scheduleMessage({
        channel: 'C1234567890',
        text: 'Scheduled message',
        post_at: postAt,
      }) as ChatScheduleMessageResponse

      expect(result.ok).toBe(true)
      expect(result.scheduled_message_id).toBe('Q1234567890')
      expect(result.post_at).toBe(postAt)
    })

    it('should schedule message with blocks', async () => {
      const postAt = Math.floor(Date.now() / 1000) + 86400 // 1 day from now

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          scheduled_message_id: 'Q1234567890',
          post_at: postAt,
        }),
      })

      // @ts-expect-error - chat.scheduleMessage not yet implemented
      await client.chat.scheduleMessage({
        channel: 'C1234567890',
        text: 'Fallback',
        post_at: postAt,
        blocks: [
          header({ text: plainText('Daily Reminder') }),
          section({ text: mrkdwn('Dont forget to submit your timesheet!') }),
        ],
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.blocks).toHaveLength(2)
    })

    it('should fail with time_in_past error', async () => {
      const pastTime = Math.floor(Date.now() / 1000) - 3600 // 1 hour ago

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: false,
          error: 'time_in_past',
        }),
      })

      await expect(
        // @ts-expect-error - chat.scheduleMessage not yet implemented
        client.chat.scheduleMessage({
          channel: 'C1234567890',
          text: 'test',
          post_at: pastTime,
        })
      ).rejects.toThrow(SlackError)
    })

    it('should fail with time_too_far error', async () => {
      const farFuture = Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60) // 1 year

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: false,
          error: 'time_too_far',
        }),
      })

      await expect(
        // @ts-expect-error - chat.scheduleMessage not yet implemented
        client.chat.scheduleMessage({
          channel: 'C1234567890',
          text: 'test',
          post_at: farFuture,
        })
      ).rejects.toThrow(SlackError)
    })
  })

  describe('chat.deleteScheduledMessage', () => {
    it('should delete a scheduled message', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
        }),
      })

      // @ts-expect-error - chat.deleteScheduledMessage not yet implemented
      const result = await client.chat.deleteScheduledMessage({
        channel: 'C1234567890',
        scheduled_message_id: 'Q1234567890',
      })

      expect(result.ok).toBe(true)
    })

    it('should fail with invalid_scheduled_message_id error', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: false,
          error: 'invalid_scheduled_message_id',
        }),
      })

      await expect(
        // @ts-expect-error - chat.deleteScheduledMessage not yet implemented
        client.chat.deleteScheduledMessage({
          channel: 'C1234567890',
          scheduled_message_id: 'Q_INVALID',
        })
      ).rejects.toThrow(SlackError)
    })
  })
})

// ============================================================================
// INTEGRATION SCENARIOS (RED Phase)
// ============================================================================

describe('Message Integration Scenarios', () => {
  let client: WebClient
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    client = new WebClient('xoxb-test-token')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should handle a typical notification workflow', async () => {
    let callCount = 0

    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++
      switch (callCount) {
        case 1: // Post initial message
          return Promise.resolve({
            ok: true,
            json: async () => ({
              ok: true,
              channel: 'C1234567890',
              ts: '1234567890.123456',
            }),
          })
        case 2: // Add reaction
          return Promise.resolve({
            ok: true,
            json: async () => ({ ok: true }),
          })
        case 3: // Update message
          return Promise.resolve({
            ok: true,
            json: async () => ({
              ok: true,
              channel: 'C1234567890',
              ts: '1234567890.123456',
            }),
          })
        case 4: // Post thread reply
          return Promise.resolve({
            ok: true,
            json: async () => ({
              ok: true,
              channel: 'C1234567890',
              ts: '1234567890.123457',
            }),
          })
        default:
          return Promise.resolve({
            ok: true,
            json: async () => ({ ok: true }),
          })
      }
    })

    // Step 1: Post initial notification
    const notification = await client.chat.postMessage({
      channel: '#deployments',
      text: ':rocket: Deployment Started',
      blocks: [
        header({ text: plainText('Deployment Started') }),
        section({
          fields: [
            mrkdwn('*Service:*\napi-server'),
            mrkdwn('*Version:*\nv2.5.0'),
            mrkdwn('*Environment:*\nProduction'),
            mrkdwn('*Status:*\n:hourglass: In Progress'),
          ],
        }),
      ],
    })
    expect(notification.ts).toBeDefined()

    // Step 2: Add reaction to show progress
    // @ts-expect-error - reactions.add not yet implemented
    await client.reactions.add({
      channel: notification.channel!,
      name: 'hourglass_flowing_sand',
      timestamp: notification.ts!,
    })

    // Step 3: Update message with completed status
    await client.chat.update({
      channel: notification.channel!,
      ts: notification.ts!,
      blocks: [
        header({ text: plainText('Deployment Completed') }),
        section({
          fields: [
            mrkdwn('*Service:*\napi-server'),
            mrkdwn('*Version:*\nv2.5.0'),
            mrkdwn('*Environment:*\nProduction'),
            mrkdwn('*Status:*\n:white_check_mark: Success'),
          ],
        }),
      ],
    })

    // Step 4: Post summary in thread
    await client.chat.postMessage({
      channel: notification.channel!,
      text: 'Deployment completed in 3m 24s',
      thread_ts: notification.ts!,
    })

    expect(callCount).toBe(4)
  })

  it('should handle interactive message flow with approval', async () => {
    let callCount = 0

    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++
      switch (callCount) {
        case 1: // Post approval request
          return Promise.resolve({
            ok: true,
            json: async () => ({
              ok: true,
              channel: 'C1234567890',
              ts: '1234567890.123456',
            }),
          })
        case 2: // Update after approval
          return Promise.resolve({
            ok: true,
            json: async () => ({
              ok: true,
              channel: 'C1234567890',
              ts: '1234567890.123456',
            }),
          })
        case 3: // Post ephemeral confirmation
          return Promise.resolve({
            ok: true,
            json: async () => ({
              ok: true,
              message_ts: '1234567890.123457',
            }),
          })
        default:
          return Promise.resolve({
            ok: true,
            json: async () => ({ ok: true }),
          })
      }
    })

    // Post interactive message with approval buttons
    const request = await client.chat.postMessage({
      channel: 'C1234567890',
      text: 'New expense report requires approval',
      blocks: [
        section({
          text: mrkdwn('*Expense Report* from <@U1234567890>'),
        }),
        section({
          fields: [
            mrkdwn('*Amount:*\n$1,234.56'),
            mrkdwn('*Category:*\nTravel'),
          ],
        }),
        actions({
          block_id: 'expense_actions',
          elements: [
            button({
              text: plainText('Approve'),
              action_id: 'approve_expense',
              style: 'primary',
              value: 'expense_12345',
            }),
            button({
              text: plainText('Deny'),
              action_id: 'deny_expense',
              style: 'danger',
              value: 'expense_12345',
            }),
          ],
        }),
      ],
    })

    // Simulate approval - update message to show approved state
    await client.chat.update({
      channel: request.channel!,
      ts: request.ts!,
      blocks: [
        section({
          text: mrkdwn('*Expense Report* from <@U1234567890> - :white_check_mark: *Approved*'),
        }),
        section({
          fields: [
            mrkdwn('*Amount:*\n$1,234.56'),
            mrkdwn('*Category:*\nTravel'),
            mrkdwn('*Approved by:*\n<@U0987654321>'),
            mrkdwn('*Approved at:*\nJan 12, 2026'),
          ],
        }),
      ],
    })

    // Send ephemeral confirmation to approver
    // @ts-expect-error - chat.postEphemeral not yet fully typed on WebClient
    await client.chat.postEphemeral({
      channel: request.channel!,
      user: 'U0987654321',
      text: ':white_check_mark: You approved the expense report for $1,234.56',
    })

    expect(callCount).toBe(3)
  })
})

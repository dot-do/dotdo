/**
 * @dotdo/slack - Message API Compatibility Tests (RED Phase)
 *
 * Comprehensive failing tests for Slack Message API compatibility:
 * - chat.postMessage
 * - chat.update
 * - chat.delete
 * - reactions.add / remove / get / list
 * - Threading via conversations.replies
 *
 * These tests verify API compatibility with @slack/web-api
 *
 * @see https://api.slack.com/methods/chat.postMessage
 * @see https://api.slack.com/methods/chat.update
 * @see https://api.slack.com/methods/chat.delete
 * @see https://api.slack.com/methods/reactions.add
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  WebClient,
  SlackError,
  type ChatPostMessageArguments,
  type ChatPostMessageResponse,
  type ChatUpdateArguments,
  type ChatUpdateResponse,
  type ChatDeleteArguments,
  type ChatDeleteResponse,
  type ChatPostEphemeralArguments,
  type ChatPostEphemeralResponse,
  type ChatScheduleMessageArguments,
  type ChatScheduleMessageResponse,
  type ReactionsAddArguments,
  type ReactionsRemoveArguments,
  type ReactionsGetArguments,
  type ReactionsListArguments,
} from '../index'

import {
  section,
  divider,
  header,
  actions,
  button,
  plainText,
  mrkdwn,
} from '../blocks'

// ============================================================================
// TEST HELPERS
// ============================================================================

interface MockResponse {
  ok: boolean
  [key: string]: unknown
}

function createMockFetch(responses: MockResponse[]) {
  let callIndex = 0
  return vi.fn().mockImplementation(async (url: string, options: RequestInit) => {
    const response = responses[Math.min(callIndex++, responses.length - 1)]
    return {
      ok: true,
      headers: new Headers({
        'content-type': 'application/json',
        ...(response.error === 'rate_limited' ? { 'Retry-After': '1' } : {}),
      }),
      json: async () => response,
    }
  })
}

function getRequestBody(fetchMock: ReturnType<typeof vi.fn>, callIndex = 0): Record<string, unknown> {
  const call = fetchMock.mock.calls[callIndex]
  if (!call) throw new Error(`No call at index ${callIndex}`)
  const body = call[1]?.body
  if (typeof body === 'string') return JSON.parse(body)
  return {}
}

function getRequestUrl(fetchMock: ReturnType<typeof vi.fn>, callIndex = 0): string {
  const call = fetchMock.mock.calls[callIndex]
  if (!call) throw new Error(`No call at index ${callIndex}`)
  return call[0]
}

// ============================================================================
// CHAT.POSTMESSAGE TESTS
// ============================================================================

describe('chat.postMessage', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.clearAllMocks()
  })

  describe('basic messaging', () => {
    it('should post a simple text message', async () => {
      globalThis.fetch = createMockFetch([
        {
          ok: true,
          channel: 'C1234567890',
          ts: '1234567890.123456',
          message: {
            type: 'message',
            text: 'Hello, World!',
            ts: '1234567890.123456',
            user: 'U1234567890',
          },
        },
      ])

      const client = new WebClient('xoxb-test-token')
      const result = await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Hello, World!',
      })

      expect(result.ok).toBe(true)
      expect(result.channel).toBe('C1234567890')
      expect(result.ts).toBe('1234567890.123456')
      expect(result.message).toBeDefined()
      expect(result.message?.text).toBe('Hello, World!')
    })

    it('should post message to channel by name', async () => {
      globalThis.fetch = createMockFetch([
        { ok: true, channel: 'C1234567890', ts: '1234567890.123456' },
      ])

      const client = new WebClient('xoxb-test-token')
      await client.chat.postMessage({
        channel: '#general',
        text: 'Hello!',
      })

      const body = getRequestBody(globalThis.fetch as ReturnType<typeof vi.fn>)
      expect(body.channel).toBe('#general')
    })

    it('should post message with mrkdwn formatting', async () => {
      globalThis.fetch = createMockFetch([
        { ok: true, channel: 'C1234567890', ts: '1234567890.123456' },
      ])

      const client = new WebClient('xoxb-test-token')
      await client.chat.postMessage({
        channel: 'C1234567890',
        text: '*bold* _italic_ ~strikethrough~',
        mrkdwn: true,
      })

      const body = getRequestBody(globalThis.fetch as ReturnType<typeof vi.fn>)
      expect(body.mrkdwn).toBe(true)
    })

    it('should post message with link_names enabled', async () => {
      globalThis.fetch = createMockFetch([
        { ok: true, channel: 'C1234567890', ts: '1234567890.123456' },
      ])

      const client = new WebClient('xoxb-test-token')
      await client.chat.postMessage({
        channel: 'C1234567890',
        text: '@here channel notification',
        link_names: true,
      })

      const body = getRequestBody(globalThis.fetch as ReturnType<typeof vi.fn>)
      expect(body.link_names).toBe(true)
    })

    it('should post message with parse mode', async () => {
      globalThis.fetch = createMockFetch([
        { ok: true, channel: 'C1234567890', ts: '1234567890.123456' },
      ])

      const client = new WebClient('xoxb-test-token')
      await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Test message',
        parse: 'full',
      })

      const body = getRequestBody(globalThis.fetch as ReturnType<typeof vi.fn>)
      expect(body.parse).toBe('full')
    })
  })

  describe('Block Kit support', () => {
    it('should post message with blocks', async () => {
      globalThis.fetch = createMockFetch([
        { ok: true, channel: 'C1234567890', ts: '1234567890.123456' },
      ])

      const client = new WebClient('xoxb-test-token')
      await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Fallback text',
        blocks: [
          header({ text: plainText('Header') }),
          section({ text: mrkdwn('*Important* message') }),
          divider(),
        ],
      })

      const body = getRequestBody(globalThis.fetch as ReturnType<typeof vi.fn>)
      expect(body.blocks).toHaveLength(3)
      expect((body.blocks as any[])[0].type).toBe('header')
      expect((body.blocks as any[])[1].type).toBe('section')
      expect((body.blocks as any[])[2].type).toBe('divider')
    })

    it('should post message with actions block', async () => {
      globalThis.fetch = createMockFetch([
        { ok: true, channel: 'C1234567890', ts: '1234567890.123456' },
      ])

      const client = new WebClient('xoxb-test-token')
      await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Action required',
        blocks: [
          section({ text: mrkdwn('Please choose an option:') }),
          actions({
            block_id: 'action_block_1',
            elements: [
              button({
                text: plainText('Approve'),
                action_id: 'approve_action',
                style: 'primary',
              }),
              button({
                text: plainText('Deny'),
                action_id: 'deny_action',
                style: 'danger',
              }),
            ],
          }),
        ],
      })

      const body = getRequestBody(globalThis.fetch as ReturnType<typeof vi.fn>)
      expect(body.blocks).toHaveLength(2)
      const actionsBlock = (body.blocks as any[])[1]
      expect(actionsBlock.type).toBe('actions')
      expect(actionsBlock.elements).toHaveLength(2)
    })

    it('should include fallback text when using blocks', async () => {
      globalThis.fetch = createMockFetch([
        { ok: true, channel: 'C1234567890', ts: '1234567890.123456' },
      ])

      const client = new WebClient('xoxb-test-token')
      await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'This is the fallback for notifications',
        blocks: [section({ text: mrkdwn('Rich content here') })],
      })

      const body = getRequestBody(globalThis.fetch as ReturnType<typeof vi.fn>)
      expect(body.text).toBe('This is the fallback for notifications')
      expect(body.blocks).toBeDefined()
    })
  })

  describe('attachments', () => {
    it('should post message with attachments', async () => {
      globalThis.fetch = createMockFetch([
        { ok: true, channel: 'C1234567890', ts: '1234567890.123456' },
      ])

      const client = new WebClient('xoxb-test-token')
      await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Message with attachment',
        attachments: [
          {
            color: '#36a64f',
            title: 'Build Passed',
            text: 'All tests passing',
            fields: [
              { title: 'Project', value: 'my-app', short: true },
              { title: 'Branch', value: 'main', short: true },
            ],
            footer: 'CI/CD Pipeline',
            ts: Math.floor(Date.now() / 1000),
          },
        ],
      })

      const body = getRequestBody(globalThis.fetch as ReturnType<typeof vi.fn>)
      expect(body.attachments).toHaveLength(1)
      expect((body.attachments as any[])[0].color).toBe('#36a64f')
      expect((body.attachments as any[])[0].title).toBe('Build Passed')
    })

    it('should post message with multiple attachments', async () => {
      globalThis.fetch = createMockFetch([
        { ok: true, channel: 'C1234567890', ts: '1234567890.123456' },
      ])

      const client = new WebClient('xoxb-test-token')
      await client.chat.postMessage({
        channel: 'C1234567890',
        attachments: [
          { color: '#36a64f', title: 'Success', text: 'First attachment' },
          { color: '#ff0000', title: 'Warning', text: 'Second attachment' },
        ],
      })

      const body = getRequestBody(globalThis.fetch as ReturnType<typeof vi.fn>)
      expect(body.attachments).toHaveLength(2)
    })
  })

  describe('bot identity', () => {
    it('should post message with custom username', async () => {
      globalThis.fetch = createMockFetch([
        { ok: true, channel: 'C1234567890', ts: '1234567890.123456' },
      ])

      const client = new WebClient('xoxb-test-token')
      await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Hello!',
        username: 'CustomBot',
      })

      const body = getRequestBody(globalThis.fetch as ReturnType<typeof vi.fn>)
      expect(body.username).toBe('CustomBot')
    })

    it('should post message with icon_emoji', async () => {
      globalThis.fetch = createMockFetch([
        { ok: true, channel: 'C1234567890', ts: '1234567890.123456' },
      ])

      const client = new WebClient('xoxb-test-token')
      await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Hello!',
        icon_emoji: ':robot_face:',
      })

      const body = getRequestBody(globalThis.fetch as ReturnType<typeof vi.fn>)
      expect(body.icon_emoji).toBe(':robot_face:')
    })

    it('should post message with icon_url', async () => {
      globalThis.fetch = createMockFetch([
        { ok: true, channel: 'C1234567890', ts: '1234567890.123456' },
      ])

      const client = new WebClient('xoxb-test-token')
      await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Hello!',
        icon_url: 'https://example.com/bot-icon.png',
      })

      const body = getRequestBody(globalThis.fetch as ReturnType<typeof vi.fn>)
      expect(body.icon_url).toBe('https://example.com/bot-icon.png')
    })

    it('should post message as_user when specified', async () => {
      globalThis.fetch = createMockFetch([
        { ok: true, channel: 'C1234567890', ts: '1234567890.123456' },
      ])

      const client = new WebClient('xoxb-test-token')
      await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Hello!',
        as_user: true,
      })

      const body = getRequestBody(globalThis.fetch as ReturnType<typeof vi.fn>)
      expect(body.as_user).toBe(true)
    })
  })

  describe('unfurling options', () => {
    it('should disable link unfurling', async () => {
      globalThis.fetch = createMockFetch([
        { ok: true, channel: 'C1234567890', ts: '1234567890.123456' },
      ])

      const client = new WebClient('xoxb-test-token')
      await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Check out https://example.com',
        unfurl_links: false,
      })

      const body = getRequestBody(globalThis.fetch as ReturnType<typeof vi.fn>)
      expect(body.unfurl_links).toBe(false)
    })

    it('should disable media unfurling', async () => {
      globalThis.fetch = createMockFetch([
        { ok: true, channel: 'C1234567890', ts: '1234567890.123456' },
      ])

      const client = new WebClient('xoxb-test-token')
      await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Image: https://example.com/image.png',
        unfurl_media: false,
      })

      const body = getRequestBody(globalThis.fetch as ReturnType<typeof vi.fn>)
      expect(body.unfurl_media).toBe(false)
    })
  })

  describe('message metadata', () => {
    it('should include message metadata', async () => {
      globalThis.fetch = createMockFetch([
        { ok: true, channel: 'C1234567890', ts: '1234567890.123456' },
      ])

      const client = new WebClient('xoxb-test-token')
      await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Order notification',
        metadata: {
          event_type: 'order_created',
          event_payload: {
            order_id: '12345',
            customer_id: 'C789',
            amount: 99.99,
          },
        },
      })

      const body = getRequestBody(globalThis.fetch as ReturnType<typeof vi.fn>)
      expect(body.metadata).toBeDefined()
      expect((body.metadata as any).event_type).toBe('order_created')
      expect((body.metadata as any).event_payload.order_id).toBe('12345')
    })
  })

  describe('error handling', () => {
    it('should throw SlackError on channel_not_found', async () => {
      globalThis.fetch = createMockFetch([
        { ok: false, error: 'channel_not_found' },
      ])

      const client = new WebClient('xoxb-test-token')

      await expect(
        client.chat.postMessage({
          channel: 'CINVALID',
          text: 'Hello!',
        })
      ).rejects.toThrow(SlackError)

      try {
        await client.chat.postMessage({ channel: 'CINVALID', text: 'Hello!' })
      } catch (error) {
        expect(error).toBeInstanceOf(SlackError)
        expect((error as SlackError).code).toBe('channel_not_found')
      }
    })

    it('should throw SlackError on not_in_channel', async () => {
      globalThis.fetch = createMockFetch([
        { ok: false, error: 'not_in_channel' },
      ])

      const client = new WebClient('xoxb-test-token')

      await expect(
        client.chat.postMessage({
          channel: 'C1234567890',
          text: 'Hello!',
        })
      ).rejects.toThrow(SlackError)
    })

    it('should throw SlackError on msg_too_long', async () => {
      globalThis.fetch = createMockFetch([
        { ok: false, error: 'msg_too_long' },
      ])

      const client = new WebClient('xoxb-test-token')

      await expect(
        client.chat.postMessage({
          channel: 'C1234567890',
          text: 'x'.repeat(50000), // Exceeds Slack's limit
        })
      ).rejects.toThrow(SlackError)
    })

    it('should throw SlackError on no_text', async () => {
      globalThis.fetch = createMockFetch([
        { ok: false, error: 'no_text' },
      ])

      const client = new WebClient('xoxb-test-token')

      await expect(
        client.chat.postMessage({
          channel: 'C1234567890',
          // Missing text and blocks
        } as ChatPostMessageArguments)
      ).rejects.toThrow(SlackError)
    })

    it('should throw SlackError on invalid_auth', async () => {
      globalThis.fetch = createMockFetch([
        { ok: false, error: 'invalid_auth' },
      ])

      const client = new WebClient('invalid-token')

      await expect(
        client.chat.postMessage({
          channel: 'C1234567890',
          text: 'Hello!',
        })
      ).rejects.toThrow(SlackError)
    })

    it('should throw SlackError on missing_scope', async () => {
      globalThis.fetch = createMockFetch([
        { ok: false, error: 'missing_scope', needed: 'chat:write' },
      ])

      const client = new WebClient('xoxb-test-token')

      await expect(
        client.chat.postMessage({
          channel: 'C1234567890',
          text: 'Hello!',
        })
      ).rejects.toThrow(SlackError)
    })
  })
})

// ============================================================================
// CHAT.UPDATE TESTS
// ============================================================================

describe('chat.update', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.clearAllMocks()
  })

  it('should update message text', async () => {
    globalThis.fetch = createMockFetch([
      {
        ok: true,
        channel: 'C1234567890',
        ts: '1234567890.123456',
        text: 'Updated message',
        message: {
          type: 'message',
          text: 'Updated message',
          ts: '1234567890.123456',
        },
      },
    ])

    const client = new WebClient('xoxb-test-token')
    const result = await client.chat.update({
      channel: 'C1234567890',
      ts: '1234567890.123456',
      text: 'Updated message',
    })

    expect(result.ok).toBe(true)
    expect(result.channel).toBe('C1234567890')
    expect(result.ts).toBe('1234567890.123456')

    const body = getRequestBody(globalThis.fetch as ReturnType<typeof vi.fn>)
    expect(body.channel).toBe('C1234567890')
    expect(body.ts).toBe('1234567890.123456')
    expect(body.text).toBe('Updated message')
  })

  it('should update message blocks', async () => {
    globalThis.fetch = createMockFetch([
      { ok: true, channel: 'C1234567890', ts: '1234567890.123456' },
    ])

    const client = new WebClient('xoxb-test-token')
    await client.chat.update({
      channel: 'C1234567890',
      ts: '1234567890.123456',
      text: 'Updated',
      blocks: [
        section({ text: mrkdwn('*Updated* content') }),
        divider(),
      ],
    })

    const body = getRequestBody(globalThis.fetch as ReturnType<typeof vi.fn>)
    expect(body.blocks).toHaveLength(2)
  })

  it('should update message attachments', async () => {
    globalThis.fetch = createMockFetch([
      { ok: true, channel: 'C1234567890', ts: '1234567890.123456' },
    ])

    const client = new WebClient('xoxb-test-token')
    await client.chat.update({
      channel: 'C1234567890',
      ts: '1234567890.123456',
      attachments: [
        { color: '#ff0000', title: 'Updated Status', text: 'Failed' },
      ],
    })

    const body = getRequestBody(globalThis.fetch as ReturnType<typeof vi.fn>)
    expect(body.attachments).toHaveLength(1)
    expect((body.attachments as any[])[0].color).toBe('#ff0000')
  })

  it('should update with metadata', async () => {
    globalThis.fetch = createMockFetch([
      { ok: true, channel: 'C1234567890', ts: '1234567890.123456' },
    ])

    const client = new WebClient('xoxb-test-token')
    await client.chat.update({
      channel: 'C1234567890',
      ts: '1234567890.123456',
      text: 'Updated',
      metadata: {
        event_type: 'status_update',
        event_payload: { status: 'completed' },
      },
    })

    const body = getRequestBody(globalThis.fetch as ReturnType<typeof vi.fn>)
    expect(body.metadata).toBeDefined()
  })

  it('should throw SlackError on message_not_found', async () => {
    globalThis.fetch = createMockFetch([
      { ok: false, error: 'message_not_found' },
    ])

    const client = new WebClient('xoxb-test-token')

    await expect(
      client.chat.update({
        channel: 'C1234567890',
        ts: '0000000000.000000',
        text: 'Updated',
      })
    ).rejects.toThrow(SlackError)
  })

  it('should throw SlackError on cant_update_message', async () => {
    globalThis.fetch = createMockFetch([
      { ok: false, error: 'cant_update_message' },
    ])

    const client = new WebClient('xoxb-test-token')

    await expect(
      client.chat.update({
        channel: 'C1234567890',
        ts: '1234567890.123456',
        text: 'Updated',
      })
    ).rejects.toThrow(SlackError)
  })

  it('should throw SlackError on edit_window_closed', async () => {
    globalThis.fetch = createMockFetch([
      { ok: false, error: 'edit_window_closed' },
    ])

    const client = new WebClient('xoxb-test-token')

    await expect(
      client.chat.update({
        channel: 'C1234567890',
        ts: '1234567890.123456',
        text: 'Updated',
      })
    ).rejects.toThrow(SlackError)
  })
})

// ============================================================================
// CHAT.DELETE TESTS
// ============================================================================

describe('chat.delete', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.clearAllMocks()
  })

  it('should delete a message', async () => {
    globalThis.fetch = createMockFetch([
      { ok: true, channel: 'C1234567890', ts: '1234567890.123456' },
    ])

    const client = new WebClient('xoxb-test-token')
    const result = await client.chat.delete({
      channel: 'C1234567890',
      ts: '1234567890.123456',
    })

    expect(result.ok).toBe(true)
    expect(result.channel).toBe('C1234567890')
    expect(result.ts).toBe('1234567890.123456')

    const url = getRequestUrl(globalThis.fetch as ReturnType<typeof vi.fn>)
    expect(url).toBe('https://slack.com/api/chat.delete')

    const body = getRequestBody(globalThis.fetch as ReturnType<typeof vi.fn>)
    expect(body.channel).toBe('C1234567890')
    expect(body.ts).toBe('1234567890.123456')
  })

  it('should delete message as_user', async () => {
    globalThis.fetch = createMockFetch([
      { ok: true, channel: 'C1234567890', ts: '1234567890.123456' },
    ])

    const client = new WebClient('xoxb-test-token')
    await client.chat.delete({
      channel: 'C1234567890',
      ts: '1234567890.123456',
      as_user: true,
    })

    const body = getRequestBody(globalThis.fetch as ReturnType<typeof vi.fn>)
    expect(body.as_user).toBe(true)
  })

  it('should throw SlackError on message_not_found', async () => {
    globalThis.fetch = createMockFetch([
      { ok: false, error: 'message_not_found' },
    ])

    const client = new WebClient('xoxb-test-token')

    await expect(
      client.chat.delete({
        channel: 'C1234567890',
        ts: '0000000000.000000',
      })
    ).rejects.toThrow(SlackError)
  })

  it('should throw SlackError on cant_delete_message', async () => {
    globalThis.fetch = createMockFetch([
      { ok: false, error: 'cant_delete_message' },
    ])

    const client = new WebClient('xoxb-test-token')

    await expect(
      client.chat.delete({
        channel: 'C1234567890',
        ts: '1234567890.123456',
      })
    ).rejects.toThrow(SlackError)
  })

  it('should throw SlackError on compliance_exports_prevent_deletion', async () => {
    globalThis.fetch = createMockFetch([
      { ok: false, error: 'compliance_exports_prevent_deletion' },
    ])

    const client = new WebClient('xoxb-test-token')

    await expect(
      client.chat.delete({
        channel: 'C1234567890',
        ts: '1234567890.123456',
      })
    ).rejects.toThrow(SlackError)
  })
})

// ============================================================================
// CHAT.POSTEPHEMERAL TESTS
// ============================================================================

describe('chat.postEphemeral', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.clearAllMocks()
  })

  it('should post ephemeral message', async () => {
    globalThis.fetch = createMockFetch([
      { ok: true, message_ts: '1234567890.123456' },
    ])

    const client = new WebClient('xoxb-test-token')
    const result = await client.chat.postEphemeral({
      channel: 'C1234567890',
      user: 'U1234567890',
      text: 'Only you can see this!',
    })

    expect(result.ok).toBe(true)
    expect(result.message_ts).toBe('1234567890.123456')

    const url = getRequestUrl(globalThis.fetch as ReturnType<typeof vi.fn>)
    expect(url).toBe('https://slack.com/api/chat.postEphemeral')

    const body = getRequestBody(globalThis.fetch as ReturnType<typeof vi.fn>)
    expect(body.channel).toBe('C1234567890')
    expect(body.user).toBe('U1234567890')
    expect(body.text).toBe('Only you can see this!')
  })

  it('should post ephemeral message with blocks', async () => {
    globalThis.fetch = createMockFetch([
      { ok: true, message_ts: '1234567890.123456' },
    ])

    const client = new WebClient('xoxb-test-token')
    await client.chat.postEphemeral({
      channel: 'C1234567890',
      user: 'U1234567890',
      text: 'Fallback',
      blocks: [section({ text: mrkdwn('*Private* message') })],
    })

    const body = getRequestBody(globalThis.fetch as ReturnType<typeof vi.fn>)
    expect(body.blocks).toHaveLength(1)
  })

  it('should post ephemeral message in thread', async () => {
    globalThis.fetch = createMockFetch([
      { ok: true, message_ts: '1234567890.123456' },
    ])

    const client = new WebClient('xoxb-test-token')
    await client.chat.postEphemeral({
      channel: 'C1234567890',
      user: 'U1234567890',
      text: 'Thread ephemeral',
      thread_ts: '1234567890.000001',
    })

    const body = getRequestBody(globalThis.fetch as ReturnType<typeof vi.fn>)
    expect(body.thread_ts).toBe('1234567890.000001')
  })

  it('should throw SlackError on user_not_in_channel', async () => {
    globalThis.fetch = createMockFetch([
      { ok: false, error: 'user_not_in_channel' },
    ])

    const client = new WebClient('xoxb-test-token')

    await expect(
      client.chat.postEphemeral({
        channel: 'C1234567890',
        user: 'U9999999999',
        text: 'Hello!',
      })
    ).rejects.toThrow(SlackError)
  })
})

// ============================================================================
// CHAT.SCHEDULEMESSAGE TESTS
// ============================================================================

describe('chat.scheduleMessage', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.clearAllMocks()
  })

  it('should schedule a message', async () => {
    globalThis.fetch = createMockFetch([
      {
        ok: true,
        channel: 'C1234567890',
        scheduled_message_id: 'Q1234ABCD',
        post_at: 1700000000,
      },
    ])

    const client = new WebClient('xoxb-test-token')
    const result = await client.chat.scheduleMessage({
      channel: 'C1234567890',
      post_at: 1700000000,
      text: 'Scheduled message!',
    })

    expect(result.ok).toBe(true)
    expect(result.scheduled_message_id).toBe('Q1234ABCD')
    expect(result.post_at).toBe(1700000000)

    const url = getRequestUrl(globalThis.fetch as ReturnType<typeof vi.fn>)
    expect(url).toBe('https://slack.com/api/chat.scheduleMessage')
  })

  it('should schedule message with blocks', async () => {
    globalThis.fetch = createMockFetch([
      {
        ok: true,
        channel: 'C1234567890',
        scheduled_message_id: 'Q1234ABCD',
        post_at: 1700000000,
      },
    ])

    const client = new WebClient('xoxb-test-token')
    await client.chat.scheduleMessage({
      channel: 'C1234567890',
      post_at: 1700000000,
      text: 'Fallback',
      blocks: [section({ text: mrkdwn('*Scheduled* announcement') })],
    })

    const body = getRequestBody(globalThis.fetch as ReturnType<typeof vi.fn>)
    expect(body.blocks).toHaveLength(1)
  })

  it('should schedule message in thread', async () => {
    globalThis.fetch = createMockFetch([
      {
        ok: true,
        channel: 'C1234567890',
        scheduled_message_id: 'Q1234ABCD',
        post_at: 1700000000,
      },
    ])

    const client = new WebClient('xoxb-test-token')
    await client.chat.scheduleMessage({
      channel: 'C1234567890',
      post_at: 1700000000,
      text: 'Scheduled reply',
      thread_ts: '1234567890.000001',
    })

    const body = getRequestBody(globalThis.fetch as ReturnType<typeof vi.fn>)
    expect(body.thread_ts).toBe('1234567890.000001')
  })

  it('should throw SlackError on time_in_past', async () => {
    globalThis.fetch = createMockFetch([
      { ok: false, error: 'time_in_past' },
    ])

    const client = new WebClient('xoxb-test-token')

    await expect(
      client.chat.scheduleMessage({
        channel: 'C1234567890',
        post_at: 1000000000, // In the past
        text: 'Too late!',
      })
    ).rejects.toThrow(SlackError)
  })

  it('should throw SlackError on time_too_far', async () => {
    globalThis.fetch = createMockFetch([
      { ok: false, error: 'time_too_far' },
    ])

    const client = new WebClient('xoxb-test-token')

    await expect(
      client.chat.scheduleMessage({
        channel: 'C1234567890',
        post_at: 9999999999, // Too far in future
        text: 'Way too far!',
      })
    ).rejects.toThrow(SlackError)
  })
})

// ============================================================================
// REACTIONS API TESTS
// ============================================================================

describe('reactions.add', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.clearAllMocks()
  })

  it('should add a reaction to a message', async () => {
    globalThis.fetch = createMockFetch([{ ok: true }])

    const client = new WebClient('xoxb-test-token')
    const result = await client.reactions.add({
      channel: 'C1234567890',
      timestamp: '1234567890.123456',
      name: 'thumbsup',
    })

    expect(result.ok).toBe(true)

    const url = getRequestUrl(globalThis.fetch as ReturnType<typeof vi.fn>)
    expect(url).toBe('https://slack.com/api/reactions.add')

    const body = getRequestBody(globalThis.fetch as ReturnType<typeof vi.fn>)
    expect(body.channel).toBe('C1234567890')
    expect(body.timestamp).toBe('1234567890.123456')
    expect(body.name).toBe('thumbsup')
  })

  it('should normalize emoji name by stripping colons', async () => {
    globalThis.fetch = createMockFetch([{ ok: true }])

    const client = new WebClient('xoxb-test-token')
    await client.reactions.add({
      channel: 'C1234567890',
      timestamp: '1234567890.123456',
      name: ':rocket:',
    })

    const body = getRequestBody(globalThis.fetch as ReturnType<typeof vi.fn>)
    expect(body.name).toBe('rocket')
  })

  it('should add custom emoji reaction', async () => {
    globalThis.fetch = createMockFetch([{ ok: true }])

    const client = new WebClient('xoxb-test-token')
    await client.reactions.add({
      channel: 'C1234567890',
      timestamp: '1234567890.123456',
      name: 'partyparrot',
    })

    const body = getRequestBody(globalThis.fetch as ReturnType<typeof vi.fn>)
    expect(body.name).toBe('partyparrot')
  })

  it('should throw SlackError on invalid_name', async () => {
    globalThis.fetch = createMockFetch([
      { ok: false, error: 'invalid_name' },
    ])

    const client = new WebClient('xoxb-test-token')

    await expect(
      client.reactions.add({
        channel: 'C1234567890',
        timestamp: '1234567890.123456',
        name: 'not_a_real_emoji_12345',
      })
    ).rejects.toThrow(SlackError)
  })

  it('should throw SlackError on already_reacted', async () => {
    globalThis.fetch = createMockFetch([
      { ok: false, error: 'already_reacted' },
    ])

    const client = new WebClient('xoxb-test-token')

    await expect(
      client.reactions.add({
        channel: 'C1234567890',
        timestamp: '1234567890.123456',
        name: 'thumbsup',
      })
    ).rejects.toThrow(SlackError)
  })

  it('should throw SlackError on too_many_reactions', async () => {
    globalThis.fetch = createMockFetch([
      { ok: false, error: 'too_many_reactions' },
    ])

    const client = new WebClient('xoxb-test-token')

    await expect(
      client.reactions.add({
        channel: 'C1234567890',
        timestamp: '1234567890.123456',
        name: 'thumbsup',
      })
    ).rejects.toThrow(SlackError)
  })
})

describe('reactions.remove', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.clearAllMocks()
  })

  it('should remove a reaction from a message', async () => {
    globalThis.fetch = createMockFetch([{ ok: true }])

    const client = new WebClient('xoxb-test-token')
    const result = await client.reactions.remove({
      channel: 'C1234567890',
      timestamp: '1234567890.123456',
      name: 'thumbsup',
    })

    expect(result.ok).toBe(true)

    const url = getRequestUrl(globalThis.fetch as ReturnType<typeof vi.fn>)
    expect(url).toBe('https://slack.com/api/reactions.remove')
  })

  it('should throw SlackError on no_reaction', async () => {
    globalThis.fetch = createMockFetch([
      { ok: false, error: 'no_reaction' },
    ])

    const client = new WebClient('xoxb-test-token')

    await expect(
      client.reactions.remove({
        channel: 'C1234567890',
        timestamp: '1234567890.123456',
        name: 'thumbsup',
      })
    ).rejects.toThrow(SlackError)
  })
})

describe('reactions.get', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.clearAllMocks()
  })

  it('should get reactions for a message', async () => {
    globalThis.fetch = createMockFetch([
      {
        ok: true,
        type: 'message',
        channel: 'C1234567890',
        message: {
          type: 'message',
          text: 'Hello!',
          ts: '1234567890.123456',
          reactions: [
            { name: 'thumbsup', count: 3, users: ['U1', 'U2', 'U3'] },
            { name: 'heart', count: 1, users: ['U4'] },
          ],
        },
      },
    ])

    const client = new WebClient('xoxb-test-token')
    const result = await client.reactions.get({
      channel: 'C1234567890',
      timestamp: '1234567890.123456',
    })

    expect(result.ok).toBe(true)
    expect(result.message?.reactions).toHaveLength(2)
    expect(result.message?.reactions?.[0].name).toBe('thumbsup')
    expect(result.message?.reactions?.[0].count).toBe(3)
  })

  it('should get full reaction details when requested', async () => {
    globalThis.fetch = createMockFetch([
      {
        ok: true,
        type: 'message',
        channel: 'C1234567890',
        message: {
          type: 'message',
          text: 'Hello!',
          ts: '1234567890.123456',
          reactions: [
            { name: 'thumbsup', count: 3, users: ['U1', 'U2', 'U3'] },
          ],
        },
      },
    ])

    const client = new WebClient('xoxb-test-token')
    await client.reactions.get({
      channel: 'C1234567890',
      timestamp: '1234567890.123456',
      full: true,
    })

    const url = getRequestUrl(globalThis.fetch as ReturnType<typeof vi.fn>)
    expect(url).toContain('full=true')
  })
})

describe('reactions.list', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.clearAllMocks()
  })

  it('should list reactions by current user', async () => {
    globalThis.fetch = createMockFetch([
      {
        ok: true,
        items: [
          {
            type: 'message',
            channel: 'C1234567890',
            message: {
              type: 'message',
              text: 'First message',
              ts: '1234567890.123456',
              reactions: [{ name: 'thumbsup', count: 1, users: ['U1'] }],
            },
          },
          {
            type: 'message',
            channel: 'C1234567890',
            message: {
              type: 'message',
              text: 'Second message',
              ts: '1234567890.123457',
              reactions: [{ name: 'heart', count: 1, users: ['U1'] }],
            },
          },
        ],
        paging: { count: 10, page: 1, pages: 1, total: 2 },
      },
    ])

    const client = new WebClient('xoxb-test-token')
    const result = await client.reactions.list({})

    expect(result.ok).toBe(true)
    expect(result.items).toHaveLength(2)
  })

  it('should list reactions by specific user', async () => {
    globalThis.fetch = createMockFetch([
      {
        ok: true,
        items: [],
        paging: { count: 10, page: 1, pages: 0, total: 0 },
      },
    ])

    const client = new WebClient('xoxb-test-token')
    await client.reactions.list({
      user: 'U1234567890',
    })

    const url = getRequestUrl(globalThis.fetch as ReturnType<typeof vi.fn>)
    expect(url).toContain('user=U1234567890')
  })

  it('should paginate reactions list', async () => {
    globalThis.fetch = createMockFetch([
      {
        ok: true,
        items: [],
        paging: { count: 10, page: 1, pages: 5, total: 50 },
      },
    ])

    const client = new WebClient('xoxb-test-token')
    await client.reactions.list({
      limit: 10,
      cursor: 'dXNlcjpVMDYxTktGUVE=',
    })

    const url = getRequestUrl(globalThis.fetch as ReturnType<typeof vi.fn>)
    expect(url).toContain('limit=10')
    expect(url).toContain('cursor=')
  })
})

// ============================================================================
// THREADING TESTS
// ============================================================================

describe('threading', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.clearAllMocks()
  })

  describe('posting thread replies', () => {
    it('should post a thread reply', async () => {
      globalThis.fetch = createMockFetch([
        {
          ok: true,
          channel: 'C1234567890',
          ts: '1234567890.123457',
          message: {
            type: 'message',
            text: 'Thread reply',
            ts: '1234567890.123457',
            thread_ts: '1234567890.123456',
          },
        },
      ])

      const client = new WebClient('xoxb-test-token')
      const result = await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Thread reply',
        thread_ts: '1234567890.123456',
      })

      expect(result.ok).toBe(true)

      const body = getRequestBody(globalThis.fetch as ReturnType<typeof vi.fn>)
      expect(body.thread_ts).toBe('1234567890.123456')
    })

    it('should broadcast thread reply to channel', async () => {
      globalThis.fetch = createMockFetch([
        { ok: true, channel: 'C1234567890', ts: '1234567890.123457' },
      ])

      const client = new WebClient('xoxb-test-token')
      await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Important thread reply',
        thread_ts: '1234567890.123456',
        reply_broadcast: true,
      })

      const body = getRequestBody(globalThis.fetch as ReturnType<typeof vi.fn>)
      expect(body.thread_ts).toBe('1234567890.123456')
      expect(body.reply_broadcast).toBe(true)
    })
  })

  describe('conversations.replies', () => {
    it('should get thread replies', async () => {
      globalThis.fetch = createMockFetch([
        {
          ok: true,
          messages: [
            {
              type: 'message',
              text: 'Parent message',
              ts: '1234567890.123456',
              user: 'U1',
              reply_count: 2,
              reply_users: ['U2', 'U3'],
              reply_users_count: 2,
            },
            {
              type: 'message',
              text: 'First reply',
              ts: '1234567890.123457',
              user: 'U2',
              thread_ts: '1234567890.123456',
            },
            {
              type: 'message',
              text: 'Second reply',
              ts: '1234567890.123458',
              user: 'U3',
              thread_ts: '1234567890.123456',
            },
          ],
          has_more: false,
        },
      ])

      const client = new WebClient('xoxb-test-token')
      const result = await client.conversations.replies({
        channel: 'C1234567890',
        ts: '1234567890.123456',
      })

      expect(result.ok).toBe(true)
      expect(result.messages).toHaveLength(3)
      expect(result.messages?.[0].text).toBe('Parent message')
      expect(result.messages?.[1].text).toBe('First reply')

      const url = getRequestUrl(globalThis.fetch as ReturnType<typeof vi.fn>)
      expect(url).toBe('https://slack.com/api/conversations.replies?channel=C1234567890&ts=1234567890.123456')
    })

    it('should paginate thread replies', async () => {
      globalThis.fetch = createMockFetch([
        {
          ok: true,
          messages: [],
          has_more: true,
          response_metadata: {
            next_cursor: 'cursor123',
          },
        },
      ])

      const client = new WebClient('xoxb-test-token')
      const result = await client.conversations.replies({
        channel: 'C1234567890',
        ts: '1234567890.123456',
        limit: 10,
      })

      expect(result.has_more).toBe(true)

      const url = getRequestUrl(globalThis.fetch as ReturnType<typeof vi.fn>)
      expect(url).toContain('limit=10')
    })

    it('should get replies within time range', async () => {
      globalThis.fetch = createMockFetch([
        { ok: true, messages: [], has_more: false },
      ])

      const client = new WebClient('xoxb-test-token')
      await client.conversations.replies({
        channel: 'C1234567890',
        ts: '1234567890.123456',
        oldest: '1234567890.000000',
        latest: '1234567899.999999',
        inclusive: true,
      })

      const url = getRequestUrl(globalThis.fetch as ReturnType<typeof vi.fn>)
      expect(url).toContain('oldest=')
      expect(url).toContain('latest=')
      expect(url).toContain('inclusive=true')
    })
  })
})

// ============================================================================
// RATE LIMITING TESTS
// ============================================================================

describe('rate limiting', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.clearAllMocks()
  })

  it('should throw SlackError on rate_limited', async () => {
    globalThis.fetch = createMockFetch([
      { ok: false, error: 'rate_limited' },
    ])

    const client = new WebClient('xoxb-test-token')

    await expect(
      client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Hello!',
      })
    ).rejects.toThrow(SlackError)

    try {
      await client.chat.postMessage({ channel: 'C1234567890', text: 'Hello!' })
    } catch (error) {
      expect((error as SlackError).code).toBe('rate_limited')
    }
  })

  it('should retry on rate limit with configured retries', async () => {
    let callCount = 0
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++
      if (callCount === 1) {
        return {
          ok: true,
          headers: new Headers({ 'Retry-After': '1' }),
          json: async () => ({ ok: false, error: 'rate_limited' }),
        }
      }
      return {
        ok: true,
        headers: new Headers(),
        json: async () => ({
          ok: true,
          channel: 'C1234567890',
          ts: '1234567890.123456',
        }),
      }
    })

    const client = new WebClient('xoxb-test-token', {
      retryConfig: { retries: 3, minTimeout: 10 },
    })

    const result = await client.chat.postMessage({
      channel: 'C1234567890',
      text: 'Hello!',
    })

    expect(result.ok).toBe(true)
    expect(callCount).toBe(2)
  })
})

// ============================================================================
// API COMPATIBILITY TESTS
// ============================================================================

describe('API compatibility', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.clearAllMocks()
  })

  it('should use correct API endpoint for chat.postMessage', async () => {
    globalThis.fetch = createMockFetch([
      { ok: true, channel: 'C1234567890', ts: '1234567890.123456' },
    ])

    const client = new WebClient('xoxb-test-token')
    await client.chat.postMessage({ channel: 'C', text: 'test' })

    const url = getRequestUrl(globalThis.fetch as ReturnType<typeof vi.fn>)
    expect(url).toBe('https://slack.com/api/chat.postMessage')
  })

  it('should use correct API endpoint for chat.update', async () => {
    globalThis.fetch = createMockFetch([
      { ok: true, channel: 'C1234567890', ts: '1234567890.123456' },
    ])

    const client = new WebClient('xoxb-test-token')
    await client.chat.update({ channel: 'C', ts: '1', text: 'test' })

    const url = getRequestUrl(globalThis.fetch as ReturnType<typeof vi.fn>)
    expect(url).toBe('https://slack.com/api/chat.update')
  })

  it('should use correct API endpoint for chat.delete', async () => {
    globalThis.fetch = createMockFetch([
      { ok: true, channel: 'C1234567890', ts: '1234567890.123456' },
    ])

    const client = new WebClient('xoxb-test-token')
    await client.chat.delete({ channel: 'C', ts: '1' })

    const url = getRequestUrl(globalThis.fetch as ReturnType<typeof vi.fn>)
    expect(url).toBe('https://slack.com/api/chat.delete')
  })

  it('should send Authorization header with Bearer token', async () => {
    let capturedHeaders: HeadersInit | undefined
    globalThis.fetch = vi.fn().mockImplementation(async (_url, options) => {
      capturedHeaders = options.headers
      return {
        ok: true,
        headers: new Headers(),
        json: async () => ({ ok: true, channel: 'C', ts: '1' }),
      }
    })

    const client = new WebClient('xoxb-test-token-12345')
    await client.chat.postMessage({ channel: 'C', text: 'test' })

    expect(capturedHeaders).toBeDefined()
    expect((capturedHeaders as Record<string, string>)['Authorization']).toBe(
      'Bearer xoxb-test-token-12345'
    )
  })

  it('should send Content-Type header as application/json', async () => {
    let capturedHeaders: HeadersInit | undefined
    globalThis.fetch = vi.fn().mockImplementation(async (_url, options) => {
      capturedHeaders = options.headers
      return {
        ok: true,
        headers: new Headers(),
        json: async () => ({ ok: true, channel: 'C', ts: '1' }),
      }
    })

    const client = new WebClient('xoxb-test-token')
    await client.chat.postMessage({ channel: 'C', text: 'test' })

    expect(capturedHeaders).toBeDefined()
    expect((capturedHeaders as Record<string, string>)['Content-Type']).toBe(
      'application/json; charset=utf-8'
    )
  })

  it('should support custom base URL', async () => {
    globalThis.fetch = createMockFetch([
      { ok: true, channel: 'C1234567890', ts: '1234567890.123456' },
    ])

    const client = new WebClient('xoxb-test-token', {
      slackApiUrl: 'https://custom-slack.example.com/api',
    })
    await client.chat.postMessage({ channel: 'C', text: 'test' })

    const url = getRequestUrl(globalThis.fetch as ReturnType<typeof vi.fn>)
    expect(url).toBe('https://custom-slack.example.com/api/chat.postMessage')
  })

  it('should support custom headers', async () => {
    let capturedHeaders: HeadersInit | undefined
    globalThis.fetch = vi.fn().mockImplementation(async (_url, options) => {
      capturedHeaders = options.headers
      return {
        ok: true,
        headers: new Headers(),
        json: async () => ({ ok: true, channel: 'C', ts: '1' }),
      }
    })

    const client = new WebClient('xoxb-test-token', {
      headers: {
        'X-Custom-Header': 'custom-value',
      },
    })
    await client.chat.postMessage({ channel: 'C', text: 'test' })

    expect(capturedHeaders).toBeDefined()
    expect((capturedHeaders as Record<string, string>)['X-Custom-Header']).toBe(
      'custom-value'
    )
  })
})

// ============================================================================
// CHAT.GETPERMALINK TESTS (RED - Not Yet Implemented)
// ============================================================================

describe('chat.getPermalink', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.clearAllMocks()
  })

  it('should get permalink for a message', async () => {
    globalThis.fetch = createMockFetch([
      {
        ok: true,
        permalink: 'https://workspace.slack.com/archives/C1234567890/p1234567890123456',
        channel: 'C1234567890',
      },
    ])

    const client = new WebClient('xoxb-test-token')
    // @ts-expect-error - Method may not exist yet (RED phase)
    const result = await client.chat.getPermalink({
      channel: 'C1234567890',
      message_ts: '1234567890.123456',
    })

    expect(result.ok).toBe(true)
    expect(result.permalink).toContain('slack.com/archives')
    expect(result.channel).toBe('C1234567890')

    const url = getRequestUrl(globalThis.fetch as ReturnType<typeof vi.fn>)
    expect(url).toContain('chat.getPermalink')
  })

  it('should throw SlackError on message_not_found for permalink', async () => {
    globalThis.fetch = createMockFetch([
      { ok: false, error: 'message_not_found' },
    ])

    const client = new WebClient('xoxb-test-token')

    await expect(
      // @ts-expect-error - Method may not exist yet (RED phase)
      client.chat.getPermalink({
        channel: 'C1234567890',
        message_ts: '0000000000.000000',
      })
    ).rejects.toThrow(SlackError)
  })
})

// ============================================================================
// CHAT.UNFURL TESTS (RED - Not Yet Implemented)
// ============================================================================

describe('chat.unfurl', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.clearAllMocks()
  })

  it('should provide custom unfurls for URLs', async () => {
    globalThis.fetch = createMockFetch([{ ok: true }])

    const client = new WebClient('xoxb-test-token')
    // @ts-expect-error - Method may not exist yet (RED phase)
    const result = await client.chat.unfurl({
      channel: 'C1234567890',
      ts: '1234567890.123456',
      unfurls: {
        'https://example.com/page': {
          title: 'Example Page',
          text: 'This is an example page',
          color: '#36a64f',
        },
      },
    })

    expect(result.ok).toBe(true)

    const url = getRequestUrl(globalThis.fetch as ReturnType<typeof vi.fn>)
    expect(url).toContain('chat.unfurl')

    const body = getRequestBody(globalThis.fetch as ReturnType<typeof vi.fn>)
    expect(body.unfurls).toBeDefined()
    expect(body.unfurls['https://example.com/page']).toBeDefined()
  })

  it('should support source parameter for unfurl', async () => {
    globalThis.fetch = createMockFetch([{ ok: true }])

    const client = new WebClient('xoxb-test-token')
    // @ts-expect-error - Method may not exist yet (RED phase)
    await client.chat.unfurl({
      channel: 'C1234567890',
      ts: '1234567890.123456',
      unfurls: {},
      source: 'composer',
    })

    const body = getRequestBody(globalThis.fetch as ReturnType<typeof vi.fn>)
    expect(body.source).toBe('composer')
  })
})

// ============================================================================
// CHAT.MEESSAGE TESTS (RED - Not Yet Implemented)
// ============================================================================

describe('chat.meMessage', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.clearAllMocks()
  })

  it('should post a /me message', async () => {
    globalThis.fetch = createMockFetch([
      { ok: true, channel: 'C1234567890', ts: '1234567890.123456' },
    ])

    const client = new WebClient('xoxb-test-token')
    // @ts-expect-error - Method may not exist yet (RED phase)
    const result = await client.chat.meMessage({
      channel: 'C1234567890',
      text: 'is thinking...',
    })

    expect(result.ok).toBe(true)

    const url = getRequestUrl(globalThis.fetch as ReturnType<typeof vi.fn>)
    expect(url).toContain('chat.meMessage')
  })
})

// ============================================================================
// SCHEDULED MESSAGES LIST TESTS (RED - Not Yet Implemented)
// ============================================================================

describe('chat.scheduledMessages.list', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.clearAllMocks()
  })

  it('should list scheduled messages', async () => {
    globalThis.fetch = createMockFetch([
      {
        ok: true,
        scheduled_messages: [
          {
            id: 'Q1234ABCD',
            channel_id: 'C1234567890',
            post_at: 1700000000,
            text: 'Scheduled message 1',
          },
          {
            id: 'Q5678EFGH',
            channel_id: 'C1234567890',
            post_at: 1700001000,
            text: 'Scheduled message 2',
          },
        ],
        response_metadata: {
          next_cursor: '',
        },
      },
    ])

    const client = new WebClient('xoxb-test-token')
    // @ts-expect-error - Method may not exist yet (RED phase)
    const result = await client.chat.scheduledMessages.list({
      channel: 'C1234567890',
    })

    expect(result.ok).toBe(true)
    expect(result.scheduled_messages).toHaveLength(2)

    const url = getRequestUrl(globalThis.fetch as ReturnType<typeof vi.fn>)
    expect(url).toContain('chat.scheduledMessages.list')
  })

  it('should paginate scheduled messages list', async () => {
    globalThis.fetch = createMockFetch([
      {
        ok: true,
        scheduled_messages: [],
        response_metadata: {
          next_cursor: 'cursor123',
        },
      },
    ])

    const client = new WebClient('xoxb-test-token')
    // @ts-expect-error - Method may not exist yet (RED phase)
    await client.chat.scheduledMessages.list({
      channel: 'C1234567890',
      limit: 10,
      cursor: 'prev_cursor',
    })

    const url = getRequestUrl(globalThis.fetch as ReturnType<typeof vi.fn>)
    expect(url).toContain('limit=10')
    expect(url).toContain('cursor=prev_cursor')
  })
})

// ============================================================================
// PINS API TESTS (RED - Not Yet Implemented)
// ============================================================================

describe('pins.add', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.clearAllMocks()
  })

  it('should pin a message', async () => {
    globalThis.fetch = createMockFetch([{ ok: true }])

    const client = new WebClient('xoxb-test-token')
    // @ts-expect-error - Method may not exist yet (RED phase)
    const result = await client.pins.add({
      channel: 'C1234567890',
      timestamp: '1234567890.123456',
    })

    expect(result.ok).toBe(true)

    const url = getRequestUrl(globalThis.fetch as ReturnType<typeof vi.fn>)
    expect(url).toContain('pins.add')
  })

  it('should throw SlackError on already_pinned', async () => {
    globalThis.fetch = createMockFetch([
      { ok: false, error: 'already_pinned' },
    ])

    const client = new WebClient('xoxb-test-token')

    await expect(
      // @ts-expect-error - Method may not exist yet (RED phase)
      client.pins.add({
        channel: 'C1234567890',
        timestamp: '1234567890.123456',
      })
    ).rejects.toThrow(SlackError)
  })
})

describe('pins.remove', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.clearAllMocks()
  })

  it('should unpin a message', async () => {
    globalThis.fetch = createMockFetch([{ ok: true }])

    const client = new WebClient('xoxb-test-token')
    // @ts-expect-error - Method may not exist yet (RED phase)
    const result = await client.pins.remove({
      channel: 'C1234567890',
      timestamp: '1234567890.123456',
    })

    expect(result.ok).toBe(true)

    const url = getRequestUrl(globalThis.fetch as ReturnType<typeof vi.fn>)
    expect(url).toContain('pins.remove')
  })

  it('should throw SlackError on no_pin', async () => {
    globalThis.fetch = createMockFetch([
      { ok: false, error: 'no_pin' },
    ])

    const client = new WebClient('xoxb-test-token')

    await expect(
      // @ts-expect-error - Method may not exist yet (RED phase)
      client.pins.remove({
        channel: 'C1234567890',
        timestamp: '1234567890.123456',
      })
    ).rejects.toThrow(SlackError)
  })
})

describe('pins.list', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.clearAllMocks()
  })

  it('should list pinned items in channel', async () => {
    globalThis.fetch = createMockFetch([
      {
        ok: true,
        items: [
          {
            type: 'message',
            channel: 'C1234567890',
            message: {
              type: 'message',
              text: 'Pinned message',
              ts: '1234567890.123456',
            },
            created: 1700000000,
            created_by: 'U1234567890',
          },
        ],
      },
    ])

    const client = new WebClient('xoxb-test-token')
    // @ts-expect-error - Method may not exist yet (RED phase)
    const result = await client.pins.list({
      channel: 'C1234567890',
    })

    expect(result.ok).toBe(true)
    expect(result.items).toHaveLength(1)
    expect(result.items[0].type).toBe('message')

    const url = getRequestUrl(globalThis.fetch as ReturnType<typeof vi.fn>)
    expect(url).toContain('pins.list')
  })
})

// ============================================================================
// BOOKMARKS API TESTS (RED - Not Yet Implemented)
// ============================================================================

describe('bookmarks.add', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.clearAllMocks()
  })

  it('should add a bookmark', async () => {
    globalThis.fetch = createMockFetch([
      {
        ok: true,
        bookmark: {
          id: 'Bk12345',
          channel_id: 'C1234567890',
          title: 'Important Link',
          link: 'https://example.com',
          emoji: ':star:',
          type: 'link',
          date_created: 1700000000,
        },
      },
    ])

    const client = new WebClient('xoxb-test-token')
    // @ts-expect-error - Method may not exist yet (RED phase)
    const result = await client.bookmarks.add({
      channel_id: 'C1234567890',
      title: 'Important Link',
      type: 'link',
      link: 'https://example.com',
      emoji: ':star:',
    })

    expect(result.ok).toBe(true)
    expect(result.bookmark.title).toBe('Important Link')

    const url = getRequestUrl(globalThis.fetch as ReturnType<typeof vi.fn>)
    expect(url).toContain('bookmarks.add')
  })
})

describe('bookmarks.remove', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.clearAllMocks()
  })

  it('should remove a bookmark', async () => {
    globalThis.fetch = createMockFetch([{ ok: true }])

    const client = new WebClient('xoxb-test-token')
    // @ts-expect-error - Method may not exist yet (RED phase)
    const result = await client.bookmarks.remove({
      bookmark_id: 'Bk12345',
      channel_id: 'C1234567890',
    })

    expect(result.ok).toBe(true)

    const url = getRequestUrl(globalThis.fetch as ReturnType<typeof vi.fn>)
    expect(url).toContain('bookmarks.remove')
  })
})

describe('bookmarks.list', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.clearAllMocks()
  })

  it('should list bookmarks in channel', async () => {
    globalThis.fetch = createMockFetch([
      {
        ok: true,
        bookmarks: [
          {
            id: 'Bk12345',
            channel_id: 'C1234567890',
            title: 'Important Link',
            link: 'https://example.com',
            type: 'link',
          },
        ],
      },
    ])

    const client = new WebClient('xoxb-test-token')
    // @ts-expect-error - Method may not exist yet (RED phase)
    const result = await client.bookmarks.list({
      channel_id: 'C1234567890',
    })

    expect(result.ok).toBe(true)
    expect(result.bookmarks).toHaveLength(1)

    const url = getRequestUrl(globalThis.fetch as ReturnType<typeof vi.fn>)
    expect(url).toContain('bookmarks.list')
  })
})

// ============================================================================
// FILES REMOTE API TESTS (RED - Not Yet Implemented)
// ============================================================================

describe('files.remote.share', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.clearAllMocks()
  })

  it('should share a remote file to channel', async () => {
    globalThis.fetch = createMockFetch([
      {
        ok: true,
        file: {
          id: 'F1234567890',
          external_id: 'ext-12345',
          external_url: 'https://example.com/file.pdf',
          title: 'Shared Document',
        },
      },
    ])

    const client = new WebClient('xoxb-test-token')
    // @ts-expect-error - Method may not exist yet (RED phase)
    const result = await client.files.remote.share({
      channels: 'C1234567890',
      external_id: 'ext-12345',
      file: 'F1234567890',
    })

    expect(result.ok).toBe(true)
    expect(result.file.external_id).toBe('ext-12345')

    const url = getRequestUrl(globalThis.fetch as ReturnType<typeof vi.fn>)
    expect(url).toContain('files.remote.share')
  })
})

// ============================================================================
// EDGE CASES
// ============================================================================

describe('edge cases', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.clearAllMocks()
  })

  it('should handle empty blocks array', async () => {
    globalThis.fetch = createMockFetch([
      { ok: true, channel: 'C1234567890', ts: '1234567890.123456' },
    ])

    const client = new WebClient('xoxb-test-token')
    await client.chat.postMessage({
      channel: 'C1234567890',
      text: 'Text only',
      blocks: [],
    })

    const body = getRequestBody(globalThis.fetch as ReturnType<typeof vi.fn>)
    expect(body.blocks).toEqual([])
  })

  it('should handle unicode characters in text', async () => {
    globalThis.fetch = createMockFetch([
      { ok: true, channel: 'C1234567890', ts: '1234567890.123456' },
    ])

    const client = new WebClient('xoxb-test-token')
    await client.chat.postMessage({
      channel: 'C1234567890',
      text: 'Hello \u{1F44B} World! \u4E2D\u6587 \u0420\u0443\u0441\u0441\u043A\u0438\u0439',
    })

    const body = getRequestBody(globalThis.fetch as ReturnType<typeof vi.fn>)
    expect(body.text).toContain('\u{1F44B}')
  })

  it('should handle special characters in text', async () => {
    globalThis.fetch = createMockFetch([
      { ok: true, channel: 'C1234567890', ts: '1234567890.123456' },
    ])

    const client = new WebClient('xoxb-test-token')
    await client.chat.postMessage({
      channel: 'C1234567890',
      text: 'Special chars: <>&"\' and `code`',
    })

    const body = getRequestBody(globalThis.fetch as ReturnType<typeof vi.fn>)
    expect(body.text).toBe('Special chars: <>&"\' and `code`')
  })

  it('should handle long message text', async () => {
    globalThis.fetch = createMockFetch([
      { ok: true, channel: 'C1234567890', ts: '1234567890.123456' },
    ])

    const longText = 'a'.repeat(4000) // Near Slack's limit
    const client = new WebClient('xoxb-test-token')
    await client.chat.postMessage({
      channel: 'C1234567890',
      text: longText,
    })

    const body = getRequestBody(globalThis.fetch as ReturnType<typeof vi.fn>)
    expect(body.text).toHaveLength(4000)
  })

  it('should handle message with all optional fields', async () => {
    globalThis.fetch = createMockFetch([
      { ok: true, channel: 'C1234567890', ts: '1234567890.123456' },
    ])

    const client = new WebClient('xoxb-test-token')
    await client.chat.postMessage({
      channel: 'C1234567890',
      text: 'Full message',
      blocks: [section({ text: mrkdwn('Block content') })],
      attachments: [{ color: '#000', text: 'Attachment' }],
      thread_ts: '1234567890.000001',
      reply_broadcast: true,
      unfurl_links: false,
      unfurl_media: false,
      mrkdwn: true,
      as_user: false,
      username: 'TestBot',
      icon_emoji: ':robot_face:',
      link_names: true,
      parse: 'full',
      metadata: {
        event_type: 'test',
        event_payload: { key: 'value' },
      },
    })

    const body = getRequestBody(globalThis.fetch as ReturnType<typeof vi.fn>)
    expect(body.text).toBe('Full message')
    expect(body.blocks).toBeDefined()
    expect(body.attachments).toBeDefined()
    expect(body.thread_ts).toBe('1234567890.000001')
    expect(body.reply_broadcast).toBe(true)
    expect(body.unfurl_links).toBe(false)
    expect(body.unfurl_media).toBe(false)
    expect(body.mrkdwn).toBe(true)
    expect(body.as_user).toBe(false)
    expect(body.username).toBe('TestBot')
    expect(body.icon_emoji).toBe(':robot_face:')
    expect(body.link_names).toBe(true)
    expect(body.parse).toBe('full')
    expect(body.metadata).toBeDefined()
  })
})

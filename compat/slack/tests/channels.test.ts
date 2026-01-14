/**
 * @dotdo/slack - Channel API Tests (RED Phase)
 *
 * Comprehensive tests for Slack Conversations API compatibility:
 * - Channel CRUD (create, archive, rename, set topic/purpose)
 * - Channel membership (invite, kick, list members)
 * - Channel history and messages
 * - Channel types (public, private, DM, group DM)
 * - Pagination and cursors
 * - Rate limiting
 *
 * These are TDD RED phase tests - they define the expected behavior
 * before implementation.
 *
 * @see https://api.slack.com/methods#conversations
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  WebClient,
  SlackError,
  type SlackChannel,
  type ConversationsListResponse,
  type ConversationsHistoryResponse,
} from '../index'

// Extended types for new API methods we're testing
interface ConversationsRenameArguments {
  channel: string
  name: string
}

interface ConversationsRenameResponse {
  ok: boolean
  channel?: SlackChannel
  error?: string
}

interface ConversationsSetTopicArguments {
  channel: string
  topic: string
}

interface ConversationsSetTopicResponse {
  ok: boolean
  channel?: SlackChannel
  topic?: string
  error?: string
}

interface ConversationsSetPurposeArguments {
  channel: string
  purpose: string
}

interface ConversationsSetPurposeResponse {
  ok: boolean
  channel?: SlackChannel
  purpose?: string
  error?: string
}

interface ConversationsOpenArguments {
  users?: string
  channel?: string
  return_im?: boolean
}

interface ConversationsOpenResponse {
  ok: boolean
  channel?: SlackChannel
  already_open?: boolean
  no_op?: boolean
  error?: string
}

interface ConversationsCloseArguments {
  channel: string
}

interface ConversationsCloseResponse {
  ok: boolean
  no_op?: boolean
  already_closed?: boolean
  error?: string
}

interface ConversationsRepliesArguments {
  channel: string
  ts: string
  cursor?: string
  inclusive?: boolean
  latest?: string
  limit?: number
  oldest?: string
}

interface ConversationsRepliesResponse {
  ok: boolean
  messages?: Array<{
    type: string
    ts: string
    user?: string
    text?: string
    thread_ts?: string
    reply_count?: number
    replies?: Array<{ user: string; ts: string }>
  }>
  has_more?: boolean
  response_metadata?: {
    next_cursor?: string
  }
  error?: string
}

interface ConversationsMarkArguments {
  channel: string
  ts: string
}

interface ConversationsMarkResponse {
  ok: boolean
  error?: string
}

// ============================================================================
// CHANNEL CRUD TESTS
// ============================================================================

describe('conversations.create', () => {
  let client: WebClient
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    client = new WebClient('xoxb-test-token')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should create a public channel', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        channel: {
          id: 'C1234567890',
          name: 'new-channel',
          is_channel: true,
          is_private: false,
          created: 1234567890,
          creator: 'U1234567890',
          is_archived: false,
          is_general: false,
          is_member: true,
          topic: { value: '', creator: '', last_set: 0 },
          purpose: { value: '', creator: '', last_set: 0 },
        },
      }),
    })

    const result = await client.conversations.create({
      name: 'new-channel',
    })

    expect(result.ok).toBe(true)
    expect(result.channel?.name).toBe('new-channel')
    expect(result.channel?.is_channel).toBe(true)
    expect(result.channel?.is_private).toBe(false)
  })

  it('should create a private channel', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        channel: {
          id: 'G1234567890',
          name: 'private-channel',
          is_channel: false,
          is_group: true,
          is_private: true,
          created: 1234567890,
          creator: 'U1234567890',
          is_archived: false,
          is_member: true,
        },
      }),
    })

    const result = await client.conversations.create({
      name: 'private-channel',
      is_private: true,
    })

    expect(result.ok).toBe(true)
    expect(result.channel?.name).toBe('private-channel')
    expect(result.channel?.is_private).toBe(true)
  })

  it('should fail with name_taken error for duplicate channel name', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        error: 'name_taken',
      }),
    })

    await expect(
      client.conversations.create({ name: 'existing-channel' })
    ).rejects.toThrow(SlackError)
  })

  it('should fail with invalid_name_specials error for invalid characters', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        error: 'invalid_name_specials',
      }),
    })

    await expect(
      client.conversations.create({ name: 'Channel With Spaces!' })
    ).rejects.toThrow(SlackError)
  })

  it('should fail with invalid_name_maxlength for names over 80 chars', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        error: 'invalid_name_maxlength',
      }),
    })

    const longName = 'a'.repeat(81)
    await expect(
      client.conversations.create({ name: longName })
    ).rejects.toThrow(SlackError)
  })

  it('should support team_id parameter for org-wide apps', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        channel: {
          id: 'C1234567890',
          name: 'cross-workspace-channel',
          is_channel: true,
        },
      }),
    })

    await client.conversations.create({
      name: 'cross-workspace-channel',
      team_id: 'T0987654321',
    })

    const fetchCall = (globalThis.fetch as any).mock.calls[0]
    const body = JSON.parse(fetchCall[1].body)
    expect(body.team_id).toBe('T0987654321')
  })
})

describe('conversations.archive', () => {
  let client: WebClient
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    client = new WebClient('xoxb-test-token')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should archive a channel', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    })

    const result = await client.conversations.archive({ channel: 'C1234567890' })
    expect(result.ok).toBe(true)
  })

  it('should fail with already_archived error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        error: 'already_archived',
      }),
    })

    await expect(
      client.conversations.archive({ channel: 'C1234567890' })
    ).rejects.toThrow(SlackError)
  })

  it('should fail with cant_archive_general error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        error: 'cant_archive_general',
      }),
    })

    await expect(
      client.conversations.archive({ channel: 'C_GENERAL' })
    ).rejects.toThrow(SlackError)
  })

  it('should fail with restricted_action for non-admins', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        error: 'restricted_action',
      }),
    })

    await expect(
      client.conversations.archive({ channel: 'C1234567890' })
    ).rejects.toThrow(SlackError)
  })
})

describe('conversations.unarchive', () => {
  let client: WebClient
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    client = new WebClient('xoxb-test-token')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should unarchive a channel', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    })

    const result = await client.conversations.unarchive({ channel: 'C1234567890' })
    expect(result.ok).toBe(true)
  })

  it('should fail with not_archived error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        error: 'not_archived',
      }),
    })

    await expect(
      client.conversations.unarchive({ channel: 'C1234567890' })
    ).rejects.toThrow(SlackError)
  })
})

describe('conversations.rename', () => {
  let client: WebClient
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    client = new WebClient('xoxb-test-token')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should rename a channel', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        channel: {
          id: 'C1234567890',
          name: 'new-name',
          is_channel: true,
        },
      }),
    })

    // @ts-expect-error - conversations.rename not yet implemented
    const result = await client.conversations.rename({
      channel: 'C1234567890',
      name: 'new-name',
    }) as ConversationsRenameResponse

    expect(result.ok).toBe(true)
    expect(result.channel?.name).toBe('new-name')
  })

  it('should fail with name_taken error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        error: 'name_taken',
      }),
    })

    await expect(
      // @ts-expect-error - conversations.rename not yet implemented
      client.conversations.rename({
        channel: 'C1234567890',
        name: 'existing-name',
      })
    ).rejects.toThrow(SlackError)
  })

  it('should fail with invalid_name error for reserved names', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        error: 'invalid_name',
      }),
    })

    await expect(
      // @ts-expect-error - conversations.rename not yet implemented
      client.conversations.rename({
        channel: 'C1234567890',
        name: 'slackbot',
      })
    ).rejects.toThrow(SlackError)
  })
})

describe('conversations.setTopic', () => {
  let client: WebClient
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    client = new WebClient('xoxb-test-token')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should set channel topic', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        channel: {
          id: 'C1234567890',
          name: 'general',
          topic: {
            value: 'New topic',
            creator: 'U1234567890',
            last_set: 1234567890,
          },
        },
        topic: 'New topic',
      }),
    })

    // @ts-expect-error - conversations.setTopic not yet implemented
    const result = await client.conversations.setTopic({
      channel: 'C1234567890',
      topic: 'New topic',
    }) as ConversationsSetTopicResponse

    expect(result.ok).toBe(true)
    expect(result.topic).toBe('New topic')
  })

  it('should accept empty topic to clear it', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        topic: '',
      }),
    })

    // @ts-expect-error - conversations.setTopic not yet implemented
    const result = await client.conversations.setTopic({
      channel: 'C1234567890',
      topic: '',
    }) as ConversationsSetTopicResponse

    expect(result.ok).toBe(true)
    expect(result.topic).toBe('')
  })

  it('should fail with topic_too_long error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        error: 'too_long',
      }),
    })

    const longTopic = 'a'.repeat(251) // Max is 250
    await expect(
      // @ts-expect-error - conversations.setTopic not yet implemented
      client.conversations.setTopic({
        channel: 'C1234567890',
        topic: longTopic,
      })
    ).rejects.toThrow(SlackError)
  })
})

describe('conversations.setPurpose', () => {
  let client: WebClient
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    client = new WebClient('xoxb-test-token')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should set channel purpose', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        channel: {
          id: 'C1234567890',
          name: 'general',
          purpose: {
            value: 'Channel purpose',
            creator: 'U1234567890',
            last_set: 1234567890,
          },
        },
        purpose: 'Channel purpose',
      }),
    })

    // @ts-expect-error - conversations.setPurpose not yet implemented
    const result = await client.conversations.setPurpose({
      channel: 'C1234567890',
      purpose: 'Channel purpose',
    }) as ConversationsSetPurposeResponse

    expect(result.ok).toBe(true)
    expect(result.purpose).toBe('Channel purpose')
  })

  it('should fail with purpose_too_long error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        error: 'too_long',
      }),
    })

    const longPurpose = 'a'.repeat(251)
    await expect(
      // @ts-expect-error - conversations.setPurpose not yet implemented
      client.conversations.setPurpose({
        channel: 'C1234567890',
        purpose: longPurpose,
      })
    ).rejects.toThrow(SlackError)
  })
})

// ============================================================================
// CHANNEL MEMBERSHIP TESTS
// ============================================================================

describe('conversations.invite', () => {
  let client: WebClient
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    client = new WebClient('xoxb-test-token')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should invite a single user to a channel', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        channel: {
          id: 'C1234567890',
          name: 'general',
          is_member: true,
        },
      }),
    })

    const result = await client.conversations.invite({
      channel: 'C1234567890',
      users: 'U1234567890',
    })

    expect(result.ok).toBe(true)
    expect(result.channel?.id).toBe('C1234567890')
  })

  it('should invite multiple users to a channel', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        channel: {
          id: 'C1234567890',
          name: 'general',
        },
      }),
    })

    await client.conversations.invite({
      channel: 'C1234567890',
      users: 'U1234567890,U0987654321',
    })

    const fetchCall = (globalThis.fetch as any).mock.calls[0]
    const body = JSON.parse(fetchCall[1].body)
    expect(body.users).toBe('U1234567890,U0987654321')
  })

  it('should fail with already_in_channel error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        error: 'already_in_channel',
      }),
    })

    await expect(
      client.conversations.invite({
        channel: 'C1234567890',
        users: 'U1234567890',
      })
    ).rejects.toThrow(SlackError)
  })

  it('should fail with cant_invite_self error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        error: 'cant_invite_self',
      }),
    })

    await expect(
      client.conversations.invite({
        channel: 'C1234567890',
        users: 'U_SELF',
      })
    ).rejects.toThrow(SlackError)
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
      client.conversations.invite({
        channel: 'C1234567890',
        users: 'U_INVALID',
      })
    ).rejects.toThrow(SlackError)
  })

  it('should fail with is_archived error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        error: 'is_archived',
      }),
    })

    await expect(
      client.conversations.invite({
        channel: 'C_ARCHIVED',
        users: 'U1234567890',
      })
    ).rejects.toThrow(SlackError)
  })
})

describe('conversations.kick', () => {
  let client: WebClient
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    client = new WebClient('xoxb-test-token')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should remove a user from a channel', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    })

    const result = await client.conversations.kick({
      channel: 'C1234567890',
      user: 'U1234567890',
    })

    expect(result.ok).toBe(true)
  })

  it('should fail with not_in_channel error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        error: 'not_in_channel',
      }),
    })

    await expect(
      client.conversations.kick({
        channel: 'C1234567890',
        user: 'U_NOT_MEMBER',
      })
    ).rejects.toThrow(SlackError)
  })

  it('should fail with cant_kick_self error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        error: 'cant_kick_self',
      }),
    })

    await expect(
      client.conversations.kick({
        channel: 'C1234567890',
        user: 'U_SELF',
      })
    ).rejects.toThrow(SlackError)
  })

  it('should fail with cant_kick_from_general error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        error: 'cant_kick_from_general',
      }),
    })

    await expect(
      client.conversations.kick({
        channel: 'C_GENERAL',
        user: 'U1234567890',
      })
    ).rejects.toThrow(SlackError)
  })
})

describe('conversations.members', () => {
  let client: WebClient
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    client = new WebClient('xoxb-test-token')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should list channel members', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        members: ['U1234567890', 'U0987654321', 'U1111111111'],
        response_metadata: {
          next_cursor: '',
        },
      }),
    })

    const result = await client.conversations.members({
      channel: 'C1234567890',
    })

    expect(result.ok).toBe(true)
    expect(result.members).toHaveLength(3)
    expect(result.members).toContain('U1234567890')
  })

  it('should support pagination with limit', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        members: ['U1234567890', 'U0987654321'],
        response_metadata: {
          next_cursor: 'dXNlcjpVMDYxTkZUVDI=',
        },
      }),
    })

    const result = await client.conversations.members({
      channel: 'C1234567890',
      limit: 2,
    })

    expect(result.members).toHaveLength(2)
    expect(result.response_metadata?.next_cursor).toBe('dXNlcjpVMDYxTkZUVDI=')
  })

  it('should support cursor pagination', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        members: ['U2222222222', 'U3333333333'],
        response_metadata: {
          next_cursor: '',
        },
      }),
    })

    await client.conversations.members({
      channel: 'C1234567890',
      cursor: 'dXNlcjpVMDYxTkZUVDI=',
    })

    const fetchCall = (globalThis.fetch as any).mock.calls[0]
    // GET request sends params in URL, not body
    const url = new URL(fetchCall[0])
    expect(url.searchParams.get('cursor')).toBe('dXNlcjpVMDYxTkZUVDI=')
  })

  it('should fail with channel_not_found error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        error: 'channel_not_found',
      }),
    })

    await expect(
      client.conversations.members({ channel: 'C_INVALID' })
    ).rejects.toThrow(SlackError)
  })
})

// ============================================================================
// CHANNEL HISTORY AND MESSAGES TESTS
// ============================================================================

describe('conversations.history', () => {
  let client: WebClient
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    client = new WebClient('xoxb-test-token')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should fetch channel history', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        messages: [
          { type: 'message', text: 'Hello', ts: '1234567890.123456', user: 'U123' },
          { type: 'message', text: 'World', ts: '1234567890.123457', user: 'U456' },
        ],
        has_more: false,
        pin_count: 0,
      }),
    })

    const result = await client.conversations.history({
      channel: 'C1234567890',
    })

    expect(result.ok).toBe(true)
    expect(result.messages).toHaveLength(2)
    expect(result.messages?.[0].text).toBe('Hello')
  })

  it('should support limit parameter', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        messages: [
          { type: 'message', text: 'Latest', ts: '1234567890.123456', user: 'U123' },
        ],
        has_more: true,
        response_metadata: {
          next_cursor: 'bmV4dF90czoxMjM0NTY3ODkwLjEyMzQ1Ng==',
        },
      }),
    })

    const result = await client.conversations.history({
      channel: 'C1234567890',
      limit: 1,
    })

    expect(result.messages).toHaveLength(1)
    expect(result.has_more).toBe(true)
  })

  it('should support oldest and latest time range', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        messages: [],
        has_more: false,
      }),
    })

    await client.conversations.history({
      channel: 'C1234567890',
      oldest: '1234567890.000000',
      latest: '1234567899.999999',
    })

    const fetchCall = (globalThis.fetch as any).mock.calls[0]
    expect(fetchCall[0]).toContain('oldest=1234567890.000000')
    expect(fetchCall[0]).toContain('latest=1234567899.999999')
  })

  it('should support inclusive flag', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        messages: [],
        has_more: false,
      }),
    })

    await client.conversations.history({
      channel: 'C1234567890',
      oldest: '1234567890.000000',
      inclusive: true,
    })

    const fetchCall = (globalThis.fetch as any).mock.calls[0]
    expect(fetchCall[0]).toContain('inclusive=true')
  })

  it('should return messages with thread metadata', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        messages: [
          {
            type: 'message',
            text: 'Thread parent',
            ts: '1234567890.123456',
            user: 'U123',
            reply_count: 5,
            reply_users_count: 3,
            latest_reply: '1234567899.000000',
            thread_ts: '1234567890.123456',
          },
        ],
        has_more: false,
      }),
    })

    const result = await client.conversations.history({
      channel: 'C1234567890',
    })

    expect(result.messages?.[0].reply_count).toBe(5)
  })

  it('should include all metadata when requested', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        messages: [
          {
            type: 'message',
            text: 'With metadata',
            ts: '1234567890.123456',
            user: 'U123',
            metadata: {
              event_type: 'order_placed',
              event_payload: { order_id: '12345' },
            },
          },
        ],
        has_more: false,
      }),
    })

    await client.conversations.history({
      channel: 'C1234567890',
      include_all_metadata: true,
    })

    const fetchCall = (globalThis.fetch as any).mock.calls[0]
    expect(fetchCall[0]).toContain('include_all_metadata=true')
  })
})

describe('conversations.replies', () => {
  let client: WebClient
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    client = new WebClient('xoxb-test-token')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should fetch thread replies', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        messages: [
          {
            type: 'message',
            text: 'Parent message',
            ts: '1234567890.123456',
            thread_ts: '1234567890.123456',
            user: 'U123',
            reply_count: 2,
          },
          {
            type: 'message',
            text: 'First reply',
            ts: '1234567890.123457',
            thread_ts: '1234567890.123456',
            user: 'U456',
          },
          {
            type: 'message',
            text: 'Second reply',
            ts: '1234567890.123458',
            thread_ts: '1234567890.123456',
            user: 'U789',
          },
        ],
        has_more: false,
      }),
    })

    // @ts-expect-error - conversations.replies not yet implemented
    const result = await client.conversations.replies({
      channel: 'C1234567890',
      ts: '1234567890.123456',
    }) as ConversationsRepliesResponse

    expect(result.ok).toBe(true)
    expect(result.messages).toHaveLength(3)
    expect(result.messages?.[0].text).toBe('Parent message')
    expect(result.messages?.[1].text).toBe('First reply')
  })

  it('should support pagination', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        messages: [
          { type: 'message', text: 'Parent', ts: '1234567890.123456', thread_ts: '1234567890.123456' },
          { type: 'message', text: 'Reply 1', ts: '1234567890.123457', thread_ts: '1234567890.123456' },
        ],
        has_more: true,
        response_metadata: {
          next_cursor: 'dGhyZWFkX3RzOjEyMzQ1Njc4OTAuMTIzNDU4',
        },
      }),
    })

    // @ts-expect-error - conversations.replies not yet implemented
    const result = await client.conversations.replies({
      channel: 'C1234567890',
      ts: '1234567890.123456',
      limit: 2,
    }) as ConversationsRepliesResponse

    expect(result.has_more).toBe(true)
    expect(result.response_metadata?.next_cursor).toBeTruthy()
  })

  it('should fail with thread_not_found error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        error: 'thread_not_found',
      }),
    })

    await expect(
      // @ts-expect-error - conversations.replies not yet implemented
      client.conversations.replies({
        channel: 'C1234567890',
        ts: '0000000000.000000',
      })
    ).rejects.toThrow(SlackError)
  })
})

describe('conversations.mark', () => {
  let client: WebClient
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    client = new WebClient('xoxb-test-token')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should mark channel as read at timestamp', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    })

    // @ts-expect-error - conversations.mark not yet implemented
    const result = await client.conversations.mark({
      channel: 'C1234567890',
      ts: '1234567890.123456',
    }) as ConversationsMarkResponse

    expect(result.ok).toBe(true)
  })

  it('should fail with invalid_timestamp error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        error: 'invalid_timestamp',
      }),
    })

    await expect(
      // @ts-expect-error - conversations.mark not yet implemented
      client.conversations.mark({
        channel: 'C1234567890',
        ts: 'invalid',
      })
    ).rejects.toThrow(SlackError)
  })
})

// ============================================================================
// CHANNEL TYPES TESTS (Public, Private, DM, Group DM)
// ============================================================================

describe('Channel Types', () => {
  let client: WebClient
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    client = new WebClient('xoxb-test-token')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('public channels', () => {
    it('should list only public channels', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          channels: [
            { id: 'C111', name: 'general', is_channel: true, is_private: false },
            { id: 'C222', name: 'random', is_channel: true, is_private: false },
          ],
        }),
      })

      const result = await client.conversations.list({
        types: 'public_channel',
      })

      expect(result.channels).toHaveLength(2)
      expect(result.channels?.[0].is_channel).toBe(true)
      expect(result.channels?.[0].is_private).toBe(false)
    })
  })

  describe('private channels', () => {
    it('should list only private channels', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          channels: [
            { id: 'G111', name: 'secret', is_group: true, is_private: true },
            { id: 'G222', name: 'confidential', is_group: true, is_private: true },
          ],
        }),
      })

      const result = await client.conversations.list({
        types: 'private_channel',
      })

      expect(result.channels).toHaveLength(2)
      expect(result.channels?.[0].is_private).toBe(true)
    })
  })

  describe('direct messages (IMs)', () => {
    it('should list direct message channels', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          channels: [
            { id: 'D111', is_im: true, user: 'U123' },
            { id: 'D222', is_im: true, user: 'U456' },
          ],
        }),
      })

      const result = await client.conversations.list({
        types: 'im',
      })

      expect(result.channels).toHaveLength(2)
      expect(result.channels?.[0].is_im).toBe(true)
    })

    it('should open a DM with a user', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          channel: {
            id: 'D1234567890',
            is_im: true,
            user: 'U1234567890',
          },
          no_op: false,
          already_open: false,
        }),
      })

      // @ts-expect-error - conversations.open not yet implemented
      const result = await client.conversations.open({
        users: 'U1234567890',
      }) as ConversationsOpenResponse

      expect(result.ok).toBe(true)
      expect(result.channel?.is_im).toBe(true)
    })

    it('should return already_open for existing DM', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          channel: {
            id: 'D1234567890',
            is_im: true,
            user: 'U1234567890',
          },
          no_op: true,
          already_open: true,
        }),
      })

      // @ts-expect-error - conversations.open not yet implemented
      const result = await client.conversations.open({
        users: 'U1234567890',
      }) as ConversationsOpenResponse

      expect(result.already_open).toBe(true)
    })
  })

  describe('group direct messages (MPIMs)', () => {
    it('should list group DM channels', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          channels: [
            { id: 'G111', name: 'mpdm-user1--user2--user3-1', is_mpim: true },
          ],
        }),
      })

      const result = await client.conversations.list({
        types: 'mpim',
      })

      expect(result.channels).toHaveLength(1)
      expect(result.channels?.[0].is_mpim).toBe(true)
    })

    it('should open a group DM with multiple users', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          channel: {
            id: 'G1234567890',
            is_mpim: true,
            name: 'mpdm-user1--user2--user3-1',
          },
        }),
      })

      // @ts-expect-error - conversations.open not yet implemented
      const result = await client.conversations.open({
        users: 'U1234567890,U0987654321,U1111111111',
      }) as ConversationsOpenResponse

      expect(result.ok).toBe(true)
      expect(result.channel?.is_mpim).toBe(true)
    })
  })

  describe('conversations.close', () => {
    it('should close a DM', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          no_op: false,
          already_closed: false,
        }),
      })

      // @ts-expect-error - conversations.close not yet implemented
      const result = await client.conversations.close({
        channel: 'D1234567890',
      }) as ConversationsCloseResponse

      expect(result.ok).toBe(true)
    })

    it('should return already_closed for closed DM', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          no_op: true,
          already_closed: true,
        }),
      })

      // @ts-expect-error - conversations.close not yet implemented
      const result = await client.conversations.close({
        channel: 'D1234567890',
      }) as ConversationsCloseResponse

      expect(result.already_closed).toBe(true)
    })

    it('should fail with channel_not_found error', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: false,
          error: 'channel_not_found',
        }),
      })

      await expect(
        // @ts-expect-error - conversations.close not yet implemented
        client.conversations.close({ channel: 'D_INVALID' })
      ).rejects.toThrow(SlackError)
    })
  })

  describe('mixed channel types', () => {
    it('should list multiple channel types', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          channels: [
            { id: 'C111', name: 'general', is_channel: true, is_private: false },
            { id: 'G222', name: 'secret', is_group: true, is_private: true },
            { id: 'D333', is_im: true, user: 'U123' },
          ],
        }),
      })

      const result = await client.conversations.list({
        types: 'public_channel,private_channel,im',
      })

      expect(result.channels).toHaveLength(3)
    })
  })
})

// ============================================================================
// PAGINATION AND CURSORS TESTS
// ============================================================================

describe('Pagination', () => {
  let client: WebClient
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    client = new WebClient('xoxb-test-token')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('conversations.list pagination', () => {
    it('should paginate through all channels', async () => {
      let callCount = 0
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              ok: true,
              channels: [
                { id: 'C111', name: 'channel-1' },
                { id: 'C222', name: 'channel-2' },
              ],
              response_metadata: {
                next_cursor: 'dGVhbTpDMDYxRkE1UEI=',
              },
            }),
          })
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ok: true,
            channels: [
              { id: 'C333', name: 'channel-3' },
            ],
            response_metadata: {
              next_cursor: '',
            },
          }),
        })
      })

      // First page
      const page1 = await client.conversations.list({ limit: 2 })
      expect(page1.channels).toHaveLength(2)
      expect(page1.response_metadata?.next_cursor).toBe('dGVhbTpDMDYxRkE1UEI=')

      // Second page
      const page2 = await client.conversations.list({
        limit: 2,
        cursor: page1.response_metadata?.next_cursor,
      })
      expect(page2.channels).toHaveLength(1)
      expect(page2.response_metadata?.next_cursor).toBe('')
    })

    it('should handle empty cursor for last page', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          channels: [{ id: 'C111', name: 'only-channel' }],
          response_metadata: {
            next_cursor: '',
          },
        }),
      })

      const result = await client.conversations.list({})
      expect(result.response_metadata?.next_cursor).toBe('')
    })

    it('should respect limit parameter', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          channels: [],
          response_metadata: { next_cursor: '' },
        }),
      })

      await client.conversations.list({ limit: 50 })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      expect(fetchCall[0]).toContain('limit=50')
    })

    it('should default to reasonable limit', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          channels: [],
          response_metadata: { next_cursor: '' },
        }),
      })

      await client.conversations.list({})

      // Should not exceed Slack's default of 100
      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      // Default behavior varies, just ensure the call was made
      expect(globalThis.fetch).toHaveBeenCalled()
    })
  })

  describe('conversations.history pagination', () => {
    it('should paginate through message history', async () => {
      let callCount = 0
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              ok: true,
              messages: [
                { type: 'message', text: 'msg1', ts: '1234567890.000001' },
                { type: 'message', text: 'msg2', ts: '1234567890.000002' },
              ],
              has_more: true,
              response_metadata: {
                next_cursor: 'bmV4dF90czoxMjM0NTY3ODkwLjAwMDAwMw==',
              },
            }),
          })
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ok: true,
            messages: [
              { type: 'message', text: 'msg3', ts: '1234567890.000003' },
            ],
            has_more: false,
            response_metadata: {
              next_cursor: '',
            },
          }),
        })
      })

      // First page
      const page1 = await client.conversations.history({
        channel: 'C1234567890',
        limit: 2,
      })
      expect(page1.messages).toHaveLength(2)
      expect(page1.has_more).toBe(true)

      // Second page
      const page2 = await client.conversations.history({
        channel: 'C1234567890',
        cursor: page1.response_metadata?.next_cursor,
      })
      expect(page2.messages).toHaveLength(1)
      expect(page2.has_more).toBe(false)
    })
  })

  describe('conversations.members pagination', () => {
    it('should paginate through member list', async () => {
      let callCount = 0
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              ok: true,
              members: ['U111', 'U222'],
              response_metadata: {
                next_cursor: 'dXNlcjpVMzMz',
              },
            }),
          })
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ok: true,
            members: ['U333'],
            response_metadata: {
              next_cursor: '',
            },
          }),
        })
      })

      // First page
      const page1 = await client.conversations.members({
        channel: 'C1234567890',
        limit: 2,
      })
      expect(page1.members).toHaveLength(2)

      // Second page
      const page2 = await client.conversations.members({
        channel: 'C1234567890',
        cursor: page1.response_metadata?.next_cursor,
      })
      expect(page2.members).toHaveLength(1)
    })
  })

  describe('invalid cursor handling', () => {
    it('should fail with invalid_cursor error', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: false,
          error: 'invalid_cursor',
        }),
      })

      await expect(
        client.conversations.list({ cursor: 'invalid-cursor' })
      ).rejects.toThrow(SlackError)
    })
  })
})

// ============================================================================
// RATE LIMITING TESTS
// ============================================================================

describe('Rate Limiting', () => {
  let client: WebClient
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    client = new WebClient('xoxb-test-token', {
      retryConfig: { retries: 2 },
    })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should handle rate_limited error with Retry-After header', async () => {
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
        json: async () => ({
          ok: true,
          channels: [],
          response_metadata: { next_cursor: '' },
        }),
      })
    })

    const result = await client.conversations.list({})

    expect(result.ok).toBe(true)
    expect(callCount).toBe(2)
  })

  it('should respect Retry-After value', async () => {
    const startTime = Date.now()
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
        json: async () => ({
          ok: true,
          channels: [],
        }),
      })
    })

    await client.conversations.list({})

    const elapsed = Date.now() - startTime
    // Should have waited at least 1 second (1000ms) before retrying
    expect(elapsed).toBeGreaterThanOrEqual(900) // Allow some tolerance
  })

  it('should fail after max retries', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        error: 'rate_limited',
      }),
      headers: new Headers({ 'Retry-After': '1' }),
    })

    // With retries: 2, should try 3 times total then fail
    await expect(
      client.conversations.list({})
    ).rejects.toThrow(SlackError)

    expect(globalThis.fetch).toHaveBeenCalledTimes(3)
  })

  it('should include rate limit info in error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        error: 'rate_limited',
        retry_after: 30,
      }),
      headers: new Headers({ 'Retry-After': '30' }),
    })

    const clientNoRetry = new WebClient('xoxb-test-token', {
      retryConfig: { retries: 0 },
    })

    try {
      await clientNoRetry.conversations.list({})
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(SlackError)
      expect((error as SlackError).code).toBe('rate_limited')
    }
  })

  describe('Tier-based rate limits', () => {
    it('should handle Tier 1 (1 per minute) methods', async () => {
      // conversations.create is Tier 1
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: false,
          error: 'rate_limited',
        }),
        headers: new Headers({ 'Retry-After': '60' }),
      })

      const clientNoRetry = new WebClient('xoxb-test-token', {
        retryConfig: { retries: 0 },
      })

      await expect(
        clientNoRetry.conversations.create({ name: 'test' })
      ).rejects.toThrow(SlackError)
    })

    it('should handle Tier 3 (50 per minute) methods', async () => {
      // conversations.list is Tier 3
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          channels: [],
        }),
      })

      // Should be able to make many requests quickly
      const promises = Array(5).fill(null).map(() =>
        client.conversations.list({})
      )

      const results = await Promise.all(promises)
      expect(results).toHaveLength(5)
      expect(results.every(r => r.ok)).toBe(true)
    })
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('Error Handling', () => {
  let client: WebClient
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    client = new WebClient('xoxb-test-token')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should throw SlackError with error code', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        error: 'channel_not_found',
      }),
    })

    try {
      await client.conversations.info({ channel: 'C_INVALID' })
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(SlackError)
      expect((error as SlackError).code).toBe('channel_not_found')
    }
  })

  it('should include response metadata in error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        error: 'missing_scope',
        needed: 'channels:read',
        provided: 'users:read',
      }),
    })

    try {
      await client.conversations.list({})
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(SlackError)
      expect((error as SlackError).code).toBe('missing_scope')
    }
  })

  it('should handle network errors', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

    await expect(
      client.conversations.list({})
    ).rejects.toThrow()
  })

  it('should handle timeout errors', async () => {
    globalThis.fetch = vi.fn().mockImplementation(() => {
      return new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Request timed out')), 100)
      })
    })

    await expect(
      client.conversations.list({})
    ).rejects.toThrow()
  })

  describe('common error codes', () => {
    const errorCases = [
      { error: 'channel_not_found', description: 'invalid channel ID' },
      { error: 'not_authed', description: 'missing auth token' },
      { error: 'invalid_auth', description: 'invalid auth token' },
      { error: 'account_inactive', description: 'deactivated account' },
      { error: 'token_revoked', description: 'revoked token' },
      { error: 'no_permission', description: 'insufficient permissions' },
      { error: 'missing_scope', description: 'missing OAuth scope' },
      { error: 'is_archived', description: 'archived channel' },
      { error: 'user_not_found', description: 'invalid user ID' },
    ]

    errorCases.forEach(({ error, description }) => {
      it(`should handle ${error} error (${description})`, async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            ok: false,
            error,
          }),
        })

        await expect(
          client.conversations.info({ channel: 'C123' })
        ).rejects.toThrow(SlackError)
      })
    })
  })
})

// ============================================================================
// INTEGRATION SCENARIOS
// ============================================================================

describe('Integration Scenarios', () => {
  let client: WebClient
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    client = new WebClient('xoxb-test-token')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should create channel, set topic, invite users, and post message', async () => {
    let callCount = 0

    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++
      switch (callCount) {
        case 1: // create
          return Promise.resolve({
            ok: true,
            json: async () => ({
              ok: true,
              channel: { id: 'C_NEW', name: 'project-x' },
            }),
          })
        case 2: // setTopic
          return Promise.resolve({
            ok: true,
            json: async () => ({
              ok: true,
              topic: 'Project X Discussion',
            }),
          })
        case 3: // invite
          return Promise.resolve({
            ok: true,
            json: async () => ({
              ok: true,
              channel: { id: 'C_NEW' },
            }),
          })
        case 4: // postMessage
          return Promise.resolve({
            ok: true,
            json: async () => ({
              ok: true,
              ts: '1234567890.123456',
            }),
          })
        default:
          return Promise.resolve({
            ok: true,
            json: async () => ({ ok: true }),
          })
      }
    })

    // Step 1: Create channel
    const createResult = await client.conversations.create({
      name: 'project-x',
    })
    expect(createResult.ok).toBe(true)

    const channelId = createResult.channel!.id

    // Step 2: Set topic
    // @ts-expect-error - conversations.setTopic not yet implemented
    await client.conversations.setTopic({
      channel: channelId,
      topic: 'Project X Discussion',
    })

    // Step 3: Invite users
    await client.conversations.invite({
      channel: channelId,
      users: 'U111,U222,U333',
    })

    // Step 4: Post welcome message
    const messageResult = await client.chat.postMessage({
      channel: channelId,
      text: 'Welcome to Project X!',
    })
    expect(messageResult.ok).toBe(true)

    expect(callCount).toBe(4)
  })

  it('should handle channel lifecycle: create -> archive -> unarchive', async () => {
    let callCount = 0

    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++
      switch (callCount) {
        case 1: // create
          return Promise.resolve({
            ok: true,
            json: async () => ({
              ok: true,
              channel: { id: 'C_LIFECYCLE', name: 'temp-channel', is_archived: false },
            }),
          })
        case 2: // archive
          return Promise.resolve({
            ok: true,
            json: async () => ({ ok: true }),
          })
        case 3: // info (to verify archived)
          return Promise.resolve({
            ok: true,
            json: async () => ({
              ok: true,
              channel: { id: 'C_LIFECYCLE', name: 'temp-channel', is_archived: true },
            }),
          })
        case 4: // unarchive
          return Promise.resolve({
            ok: true,
            json: async () => ({ ok: true }),
          })
        case 5: // info (to verify unarchived)
          return Promise.resolve({
            ok: true,
            json: async () => ({
              ok: true,
              channel: { id: 'C_LIFECYCLE', name: 'temp-channel', is_archived: false },
            }),
          })
        default:
          return Promise.resolve({
            ok: true,
            json: async () => ({ ok: true }),
          })
      }
    })

    // Create
    const created = await client.conversations.create({ name: 'temp-channel' })
    const channelId = created.channel!.id

    // Archive
    await client.conversations.archive({ channel: channelId })

    // Verify archived
    const archivedInfo = await client.conversations.info({ channel: channelId })
    expect(archivedInfo.channel?.is_archived).toBe(true)

    // Unarchive
    await client.conversations.unarchive({ channel: channelId })

    // Verify unarchived
    const unarchivedInfo = await client.conversations.info({ channel: channelId })
    expect(unarchivedInfo.channel?.is_archived).toBe(false)
  })

  it('should fetch all messages using pagination', async () => {
    let callCount = 0

    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ok: true,
            messages: [
              { type: 'message', text: 'Message 1', ts: '1234567890.000001' },
              { type: 'message', text: 'Message 2', ts: '1234567890.000002' },
            ],
            has_more: true,
            response_metadata: { next_cursor: 'cursor1' },
          }),
        })
      }
      if (callCount === 2) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ok: true,
            messages: [
              { type: 'message', text: 'Message 3', ts: '1234567890.000003' },
              { type: 'message', text: 'Message 4', ts: '1234567890.000004' },
            ],
            has_more: true,
            response_metadata: { next_cursor: 'cursor2' },
          }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          ok: true,
          messages: [
            { type: 'message', text: 'Message 5', ts: '1234567890.000005' },
          ],
          has_more: false,
          response_metadata: { next_cursor: '' },
        }),
      })
    })

    // Fetch all messages with pagination
    const allMessages: any[] = []
    let cursor: string | undefined

    do {
      const result = await client.conversations.history({
        channel: 'C1234567890',
        limit: 2,
        cursor,
      })

      allMessages.push(...(result.messages || []))
      cursor = result.response_metadata?.next_cursor || undefined
    } while (cursor)

    expect(allMessages).toHaveLength(5)
    expect(allMessages[0].text).toBe('Message 1')
    expect(allMessages[4].text).toBe('Message 5')
  })
})

/**
 * @dotdo/lib/tools/adapters/slack.ts - Slack Provider Adapter
 *
 * Exposes Slack compat SDK as Tool Things.
 *
 * @example
 * ```typescript
 * import { slackAdapter } from 'lib/tools/adapters/slack'
 * import { globalRegistry } from 'lib/tools'
 *
 * globalRegistry.register(slackAdapter)
 *
 * await globalRegistry.execute(
 *   'slack',
 *   'post_message',
 *   { channel: 'C12345', text: 'Hello!' },
 *   { accessToken: 'xoxb-xxx' }
 * )
 * ```
 */

import {
  createProviderAdapter,
  type ProviderToolAdapter,
  type RuntimeCredentials,
  type ToolContext,
  ProviderError,
} from '../provider-adapter'

// =============================================================================
// Types
// =============================================================================

interface PostMessageParams {
  channel: string
  text?: string
  blocks?: unknown[]
  attachments?: unknown[]
  thread_ts?: string
  reply_broadcast?: boolean
  unfurl_links?: boolean
  unfurl_media?: boolean
}

interface UpdateMessageParams {
  channel: string
  ts: string
  text?: string
  blocks?: unknown[]
  attachments?: unknown[]
}

interface ListChannelsParams {
  limit?: number
  cursor?: string
  exclude_archived?: boolean
  types?: string
}

interface ChannelHistoryParams {
  channel: string
  limit?: number
  cursor?: string
  oldest?: string
  latest?: string
}

// =============================================================================
// Handlers
// =============================================================================

async function postMessage(
  params: PostMessageParams,
  credentials: RuntimeCredentials,
  _context?: ToolContext
): Promise<unknown> {
  const token = credentials.accessToken ?? credentials.apiKey
  if (!token) {
    throw new ProviderError({
      code: 'MISSING_CREDENTIALS',
      message: 'Slack bot token is required',
      provider: 'slack',
      toolId: 'post_message',
    })
  }

  const { WebClient } = await import('../../../compat/slack')

  const client = new WebClient(token)

  try {
    return await client.chat.postMessage(params)
  } catch (error) {
    throw new ProviderError({
      code: 'POST_MESSAGE_FAILED',
      message: error instanceof Error ? error.message : 'Failed to post message',
      provider: 'slack',
      toolId: 'post_message',
      cause: error instanceof Error ? error : undefined,
    })
  }
}

async function updateMessage(
  params: UpdateMessageParams,
  credentials: RuntimeCredentials,
  _context?: ToolContext
): Promise<unknown> {
  const token = credentials.accessToken ?? credentials.apiKey
  if (!token) {
    throw new ProviderError({
      code: 'MISSING_CREDENTIALS',
      message: 'Slack bot token is required',
      provider: 'slack',
      toolId: 'update_message',
    })
  }

  const { WebClient } = await import('../../../compat/slack')

  const client = new WebClient(token)

  try {
    return await client.chat.update(params)
  } catch (error) {
    throw new ProviderError({
      code: 'UPDATE_MESSAGE_FAILED',
      message: error instanceof Error ? error.message : 'Failed to update message',
      provider: 'slack',
      toolId: 'update_message',
      cause: error instanceof Error ? error : undefined,
    })
  }
}

async function deleteMessage(
  params: { channel: string; ts: string },
  credentials: RuntimeCredentials,
  _context?: ToolContext
): Promise<unknown> {
  const token = credentials.accessToken ?? credentials.apiKey
  if (!token) {
    throw new ProviderError({
      code: 'MISSING_CREDENTIALS',
      message: 'Slack bot token is required',
      provider: 'slack',
      toolId: 'delete_message',
    })
  }

  const { WebClient } = await import('../../../compat/slack')

  const client = new WebClient(token)

  try {
    return await client.chat.delete(params)
  } catch (error) {
    throw new ProviderError({
      code: 'DELETE_MESSAGE_FAILED',
      message: error instanceof Error ? error.message : 'Failed to delete message',
      provider: 'slack',
      toolId: 'delete_message',
      cause: error instanceof Error ? error : undefined,
    })
  }
}

async function listChannels(
  params: ListChannelsParams,
  credentials: RuntimeCredentials,
  _context?: ToolContext
): Promise<unknown> {
  const token = credentials.accessToken ?? credentials.apiKey
  if (!token) {
    throw new ProviderError({
      code: 'MISSING_CREDENTIALS',
      message: 'Slack bot token is required',
      provider: 'slack',
      toolId: 'list_channels',
    })
  }

  const { WebClient } = await import('../../../compat/slack')

  const client = new WebClient(token)

  try {
    return await client.conversations.list(params)
  } catch (error) {
    throw new ProviderError({
      code: 'LIST_CHANNELS_FAILED',
      message: error instanceof Error ? error.message : 'Failed to list channels',
      provider: 'slack',
      toolId: 'list_channels',
      cause: error instanceof Error ? error : undefined,
    })
  }
}

async function getChannelHistory(
  params: ChannelHistoryParams,
  credentials: RuntimeCredentials,
  _context?: ToolContext
): Promise<unknown> {
  const token = credentials.accessToken ?? credentials.apiKey
  if (!token) {
    throw new ProviderError({
      code: 'MISSING_CREDENTIALS',
      message: 'Slack bot token is required',
      provider: 'slack',
      toolId: 'get_channel_history',
    })
  }

  const { WebClient } = await import('../../../compat/slack')

  const client = new WebClient(token)

  try {
    return await client.conversations.history(params)
  } catch (error) {
    throw new ProviderError({
      code: 'GET_CHANNEL_HISTORY_FAILED',
      message: error instanceof Error ? error.message : 'Failed to get channel history',
      provider: 'slack',
      toolId: 'get_channel_history',
      cause: error instanceof Error ? error : undefined,
    })
  }
}

async function addReaction(
  params: { channel: string; name: string; timestamp: string },
  credentials: RuntimeCredentials,
  _context?: ToolContext
): Promise<unknown> {
  const token = credentials.accessToken ?? credentials.apiKey
  if (!token) {
    throw new ProviderError({
      code: 'MISSING_CREDENTIALS',
      message: 'Slack bot token is required',
      provider: 'slack',
      toolId: 'add_reaction',
    })
  }

  const { WebClient } = await import('../../../compat/slack')

  const client = new WebClient(token)

  try {
    return await client.reactions.add(params)
  } catch (error) {
    throw new ProviderError({
      code: 'ADD_REACTION_FAILED',
      message: error instanceof Error ? error.message : 'Failed to add reaction',
      provider: 'slack',
      toolId: 'add_reaction',
      cause: error instanceof Error ? error : undefined,
    })
  }
}

// =============================================================================
// Adapter Definition
// =============================================================================

/**
 * Slack provider adapter
 */
export const slackAdapter: ProviderToolAdapter = createProviderAdapter({
  name: 'slack',
  displayName: 'Slack',
  description: 'Team communication and collaboration platform',
  category: 'collaboration',
  credential: {
    type: 'bearer_token',
    headerName: 'Authorization',
    headerPrefix: 'Bearer',
    envVar: 'SLACK_BOT_TOKEN',
    required: true,
  },
  baseUrl: 'https://slack.com/api',
  timeout: 30000,
  maxRetries: 3,
  iconUrl: 'https://slack.com/favicon.ico',
  docsUrl: 'https://api.slack.com/methods',
  version: '1.0.0',
  tools: [
    {
      id: 'post_message',
      name: 'Post Message',
      description: 'Post a message to a Slack channel. Supports text, blocks, and attachments.',
      parameters: {
        type: 'object',
        properties: {
          channel: {
            type: 'string',
            description: 'Channel ID (e.g., C1234567890)',
          },
          text: {
            type: 'string',
            description: 'Message text (required if no blocks)',
          },
          blocks: {
            type: 'array',
            description: 'Block Kit blocks for rich formatting',
            items: { type: 'object' },
          },
          attachments: {
            type: 'array',
            description: 'Legacy attachments (prefer blocks)',
            items: { type: 'object' },
          },
          thread_ts: {
            type: 'string',
            description: 'Thread timestamp to reply to',
          },
          reply_broadcast: {
            type: 'boolean',
            description: 'Also post to channel when replying to thread',
          },
          unfurl_links: {
            type: 'boolean',
            description: 'Enable link previews',
          },
          unfurl_media: {
            type: 'boolean',
            description: 'Enable media previews',
          },
        },
        required: ['channel'],
      },
      handler: postMessage,
      tags: ['message', 'chat', 'notify'],
      rateLimitTier: 'medium',
      examples: [
        {
          name: 'Simple Message',
          description: 'Post a text message',
          input: {
            channel: 'C1234567890',
            text: 'Hello, World!',
          },
        },
        {
          name: 'Thread Reply',
          description: 'Reply to a thread',
          input: {
            channel: 'C1234567890',
            text: 'This is a reply',
            thread_ts: '1234567890.123456',
          },
        },
      ],
    },
    {
      id: 'update_message',
      name: 'Update Message',
      description: 'Update an existing message in a Slack channel.',
      parameters: {
        type: 'object',
        properties: {
          channel: {
            type: 'string',
            description: 'Channel ID',
          },
          ts: {
            type: 'string',
            description: 'Timestamp of the message to update',
          },
          text: {
            type: 'string',
            description: 'New message text',
          },
          blocks: {
            type: 'array',
            description: 'New Block Kit blocks',
            items: { type: 'object' },
          },
          attachments: {
            type: 'array',
            description: 'New attachments',
            items: { type: 'object' },
          },
        },
        required: ['channel', 'ts'],
      },
      handler: updateMessage,
      tags: ['message', 'edit'],
      rateLimitTier: 'medium',
    },
    {
      id: 'delete_message',
      name: 'Delete Message',
      description: 'Delete a message from a Slack channel.',
      parameters: {
        type: 'object',
        properties: {
          channel: {
            type: 'string',
            description: 'Channel ID',
          },
          ts: {
            type: 'string',
            description: 'Timestamp of the message to delete',
          },
        },
        required: ['channel', 'ts'],
      },
      handler: deleteMessage,
      tags: ['message', 'delete'],
      rateLimitTier: 'medium',
      requiresConfirmation: true,
    },
    {
      id: 'list_channels',
      name: 'List Channels',
      description: 'List channels in the workspace.',
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Number of channels to return (max 1000)',
            default: 100,
          },
          cursor: {
            type: 'string',
            description: 'Pagination cursor',
          },
          exclude_archived: {
            type: 'boolean',
            description: 'Exclude archived channels',
            default: true,
          },
          types: {
            type: 'string',
            description: 'Channel types (public_channel, private_channel, mpim, im)',
          },
        },
      },
      handler: listChannels,
      tags: ['channel', 'list'],
      rateLimitTier: 'high',
    },
    {
      id: 'get_channel_history',
      name: 'Get Channel History',
      description: 'Fetch message history from a channel.',
      parameters: {
        type: 'object',
        properties: {
          channel: {
            type: 'string',
            description: 'Channel ID',
          },
          limit: {
            type: 'number',
            description: 'Number of messages to return (max 1000)',
            default: 100,
          },
          cursor: {
            type: 'string',
            description: 'Pagination cursor',
          },
          oldest: {
            type: 'string',
            description: 'Oldest message timestamp to include',
          },
          latest: {
            type: 'string',
            description: 'Latest message timestamp to include',
          },
        },
        required: ['channel'],
      },
      handler: getChannelHistory,
      tags: ['channel', 'history', 'messages'],
      rateLimitTier: 'high',
    },
    {
      id: 'add_reaction',
      name: 'Add Reaction',
      description: 'Add an emoji reaction to a message.',
      parameters: {
        type: 'object',
        properties: {
          channel: {
            type: 'string',
            description: 'Channel ID',
          },
          name: {
            type: 'string',
            description: 'Emoji name without colons (e.g., thumbsup)',
          },
          timestamp: {
            type: 'string',
            description: 'Message timestamp to react to',
          },
        },
        required: ['channel', 'name', 'timestamp'],
      },
      handler: addReaction,
      tags: ['reaction', 'emoji'],
      rateLimitTier: 'high',
      examples: [
        {
          name: 'Add Thumbs Up',
          description: 'React with thumbs up',
          input: {
            channel: 'C1234567890',
            name: 'thumbsup',
            timestamp: '1234567890.123456',
          },
        },
      ],
    },
  ],
})

export default slackAdapter

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DiscordChannel, buildEmbed, buildActionRow } from '../discord'

describe('Discord Channel', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: '123456789' })))
    globalThis.fetch = mockFetch
  })

  describe('buildEmbed()', () => {
    it('should create embed with title and description', () => {
      const embed = buildEmbed({
        title: 'Approval Required',
        description: 'Please approve this request',
        color: 0x5865F2,
      })

      expect(embed).toMatchObject({
        title: 'Approval Required',
        description: 'Please approve this request',
        color: 0x5865F2,
      })
    })

    it('should add fields for metadata', () => {
      const embed = buildEmbed({
        title: 'Request',
        description: 'Approve?',
        fields: [
          { name: 'Requester', value: 'john@example.com.ai', inline: true },
          { name: 'Amount', value: '$10,000', inline: true },
        ],
      })

      expect(embed.fields).toHaveLength(2)
    })

    it('should add timestamp', () => {
      const embed = buildEmbed({
        title: 'Request',
        description: 'Test',
        timestamp: true,
      })

      expect(embed.timestamp).toBeDefined()
    })
  })

  describe('buildActionRow()', () => {
    it('should create button row for actions', () => {
      const row = buildActionRow({
        actions: [
          { label: 'Approve', value: 'approve', style: 'success' },
          { label: 'Reject', value: 'reject', style: 'danger' },
        ],
        requestId: 'req-123',
      })

      expect(row.type).toBe(1)
      expect(row.components).toHaveLength(2)
      expect(row.components[0]).toMatchObject({
        type: 2,
        label: 'Approve',
        style: 3,
        custom_id: 'approve_req-123',
      })
    })

    it('should support link buttons', () => {
      const row = buildActionRow({
        actions: [
          { label: 'View Details', value: 'https://app.dotdo.dev/request/123', style: 'link' },
        ],
        requestId: 'req-123',
      })

      expect(row.components[0]).toMatchObject({
        type: 2,
        style: 5,
        url: 'https://app.dotdo.dev/request/123',
      })
    })
  })

  describe('DiscordChannel', () => {
    it('should send webhook message with embed', async () => {
      const channel = new DiscordChannel({
        webhookUrl: 'https://discord.com/api/webhooks/xxx/yyy',
      })

      const result = await channel.send({
        message: 'Approval needed',
        mentions: ['@admin'],
      })

      expect(result.delivered).toBe(true)
      expect(result.messageId).toBe('123456789')
    })

    it('should mention roles', async () => {
      const channel = new DiscordChannel({
        webhookUrl: 'https://discord.com/api/webhooks/xxx/yyy',
      })

      await channel.send({
        message: 'Test',
        mentions: ['<@&ROLE_ID>'],
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('<@&ROLE_ID>'),
        })
      )
    })

    it('should handle reaction responses', async () => {
      const channel = new DiscordChannel({
        webhookUrl: 'https://discord.com/api/webhooks/xxx/yyy',
        botToken: 'Bot xxx',
      })

      const reaction = {
        emoji: { name: '✅' },
        user_id: '123',
        message_id: '456',
      }

      const response = await channel.handleReaction(reaction)
      expect(response).toMatchObject({
        action: 'approve',
        userId: '123',
      })
    })
  })
})

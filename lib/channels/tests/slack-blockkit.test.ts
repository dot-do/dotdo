import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SlackBlockKitChannel, buildApprovalBlocks, buildFormBlocks } from '../slack-blockkit'

describe('Slack BlockKit Channel', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, ts: '123.456' })))
    globalThis.fetch = mockFetch
  })

  describe('buildApprovalBlocks()', () => {
    it('should create section with message', () => {
      const blocks = buildApprovalBlocks({
        message: 'Approve this request?',
        requestId: 'req-123',
      })

      expect(blocks[0]).toMatchObject({
        type: 'section',
        text: { type: 'mrkdwn', text: 'Approve this request?' },
      })
    })

    it('should add approve/reject buttons', () => {
      const blocks = buildApprovalBlocks({
        message: 'Approve?',
        requestId: 'req-123',
      })

      const actions = blocks.find(b => b.type === 'actions')
      expect(actions.elements).toHaveLength(2)
      expect(actions.elements[0]).toMatchObject({
        type: 'button',
        text: { type: 'plain_text', text: 'Approve' },
        style: 'primary',
        action_id: 'approve_req-123',
      })
    })

    it('should support custom actions', () => {
      const blocks = buildApprovalBlocks({
        message: 'Choose action',
        requestId: 'req-123',
        actions: [
          { label: 'Approve', value: 'approve', style: 'primary' },
          { label: 'Reject', value: 'reject', style: 'danger' },
          { label: 'Delegate', value: 'delegate' },
        ],
      })

      const actions = blocks.find(b => b.type === 'actions')
      expect(actions.elements).toHaveLength(3)
    })
  })

  describe('buildFormBlocks()', () => {
    it('should create input blocks for text fields', () => {
      const blocks = buildFormBlocks({
        fields: [
          { name: 'reason', type: 'text', label: 'Reason for rejection' },
        ],
      })

      expect(blocks[0]).toMatchObject({
        type: 'input',
        element: { type: 'plain_text_input' },
        label: { type: 'plain_text', text: 'Reason for rejection' },
      })
    })

    it('should create select blocks for options', () => {
      const blocks = buildFormBlocks({
        fields: [
          { name: 'priority', type: 'select', label: 'Priority', options: ['low', 'medium', 'high'] },
        ],
      })

      expect(blocks[0].element.type).toBe('static_select')
    })
  })

  describe('SlackBlockKitChannel', () => {
    it('should send message with blocks', async () => {
      const channel = new SlackBlockKitChannel({
        webhookUrl: 'https://hooks.slack.com/xxx',
        botToken: 'xoxb-xxx',
      })

      const result = await channel.send({
        message: 'Test',
        channel: '#approvals',
      })

      expect(result.delivered).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('blocks'),
        })
      )
    })

    it('should handle interactive responses', async () => {
      const channel = new SlackBlockKitChannel({
        webhookUrl: 'https://hooks.slack.com/xxx',
        botToken: 'xoxb-xxx',
      })

      const payload = {
        type: 'block_actions',
        user: { id: 'U123', name: 'john' },
        actions: [{ action_id: 'approve_req-123', value: 'approve' }],
      }

      const response = await channel.handleInteraction(payload)
      expect(response).toMatchObject({
        action: 'approve',
        userId: 'U123',
      })
    })
  })
})

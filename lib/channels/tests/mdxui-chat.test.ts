import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MDXUIChatChannel, ChatMessage, ChatConversation } from '../mdxui-chat'

describe('MDXUI Chat Channel', () => {
  describe('ChatConversation', () => {
    it('should create conversation with initial message', () => {
      const conversation = new ChatConversation({
        initialMessage: 'How can I help you today?',
        userId: 'user-123',
      })

      expect(conversation.messages).toHaveLength(1)
      expect(conversation.messages[0]).toMatchObject({
        role: 'assistant',
        content: 'How can I help you today?',
      })
    })

    it('should add user messages', () => {
      const conversation = new ChatConversation({
        initialMessage: 'Hello',
        userId: 'user-123',
      })

      conversation.addMessage({ role: 'user', content: 'I need help' })
      expect(conversation.messages).toHaveLength(2)
    })

    it('should support action buttons in messages', () => {
      const conversation = new ChatConversation({
        initialMessage: 'Choose an option',
        userId: 'user-123',
        actions: [
          { label: 'Option A', value: 'a' },
          { label: 'Option B', value: 'b' },
        ],
      })

      expect(conversation.messages[0].actions).toHaveLength(2)
    })

    it('should support form inputs', () => {
      const conversation = new ChatConversation({
        initialMessage: 'Please fill out:',
        userId: 'user-123',
        form: {
          fields: [
            { name: 'email', type: 'text', label: 'Email' },
            { name: 'subscribe', type: 'boolean', label: 'Subscribe?' },
          ],
        },
      })

      expect(conversation.messages[0].form).toBeDefined()
    })
  })

  describe('MDXUIChatChannel', () => {
    it('should send message to user DO', async () => {
      const mockUserDO = {
        idFromName: vi.fn().mockReturnValue({ toString: () => 'id' }),
        get: vi.fn().mockReturnValue({
          fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ sent: true }))),
        }),
      }

      const channel = new MDXUIChatChannel({
        env: { USER_DO: mockUserDO },
      })

      const result = await channel.send({
        message: 'Hello!',
        userId: 'user-123',
      })

      expect(result.delivered).toBe(true)
    })

    it('should wait for user response', async () => {
      const mockUserDO = {
        idFromName: vi.fn().mockReturnValue({ toString: () => 'id' }),
        get: vi.fn().mockReturnValue({
          fetch: vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ sent: true })))
            .mockResolvedValueOnce(new Response(JSON.stringify({
              response: { action: 'approve', data: { comment: 'Looks good' } }
            }))),
        }),
      }

      const channel = new MDXUIChatChannel({
        env: { USER_DO: mockUserDO },
      })

      await channel.send({ message: 'Approve?', userId: 'user-123' })
      const response = await channel.waitForResponse({ timeout: 5000 })

      expect(response).toMatchObject({
        action: 'approve',
        data: { comment: 'Looks good' },
      })
    })

    it('should support real-time updates via WebSocket', async () => {
      const channel = new MDXUIChatChannel({
        env: { USER_DO: {} as any },
        realtime: true,
      })

      expect(channel.supportsRealtime).toBe(true)
    })

    it('should render MDX components in messages', async () => {
      const mockUserDO = {
        idFromName: vi.fn().mockReturnValue({ toString: () => 'id' }),
        get: vi.fn().mockReturnValue({
          fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ sent: true }))),
        }),
      }

      const channel = new MDXUIChatChannel({
        env: { USER_DO: mockUserDO },
      })

      const result = await channel.send({
        message: 'Check this chart:',
        userId: 'user-123',
        mdxContent: `<Chart data={[1,2,3]} />`,
      })

      expect(result.delivered).toBe(true)
    })

    it('should handle typing indicators', async () => {
      const mockUserDO = {
        idFromName: vi.fn().mockReturnValue({ toString: () => 'id' }),
        get: vi.fn().mockReturnValue({
          fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }))),
        }),
      }

      const channel = new MDXUIChatChannel({
        env: { USER_DO: mockUserDO },
      })

      await channel.sendTypingIndicator('user-123')
      // Should not throw
    })
  })
})

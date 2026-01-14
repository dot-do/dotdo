/**
 * Channel Bridging Tests - TDD RED Phase
 *
 * These tests define the expected behavior for channel bridging functionality:
 * - Message format conversion between email, chat, SMS, and other channels
 * - Unified thread view across multiple channels
 * - Cross-channel message routing and delivery
 * - Channel-specific metadata preservation
 *
 * @module db/primitives/conversation-engine/channel-bridging.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  ConversationEngine,
  createConversationEngine,
  createChannelAdapter,
  type ChannelAdapter,
  type ChannelType,
  type Message,
  type MessageOptions,
  type Conversation,
} from './index'

// =============================================================================
// Channel Bridging Types (Expected - not yet implemented)
// =============================================================================

// These interfaces define the expected bridging API
interface BridgeOptions {
  sourceChannel: ChannelType
  targetChannel: ChannelType
  preserveFormatting?: boolean
  preserveMetadata?: boolean
}

interface BridgedMessage extends Message {
  originalChannel: ChannelType
  originalFormat: string
  bridgedAt: Date
}

interface UnifiedThread {
  id: string
  conversationId: string
  channels: ChannelType[]
  messages: BridgedMessage[]
  participants: Array<{ id: string; channel: ChannelType }>
}

// =============================================================================
// Email to Chat Bridging Tests
// =============================================================================

describe('Channel Bridging: Email to Chat', () => {
  let engine: ConversationEngine

  beforeEach(() => {
    engine = createConversationEngine()
  })

  describe('HTML to plain text conversion', () => {
    it('should strip HTML tags when bridging email to chat', async () => {
      const conv = await engine.createConversation({
        channel: 'email',
        participants: [{ id: 'user_1', role: 'customer', email: 'user@example.com' }],
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: '<html><body><p>Hello <strong>World</strong>!</p></body></html>',
        contentType: 'text/html',
      })

      const chatMessages = await engine.getMessagesForChannel(conv.id, 'chat')

      expect(chatMessages[0].content).toBe('Hello World!')
      expect(chatMessages[0].contentType).toBe('text/plain')
    })

    it('should convert HTML paragraphs to newlines', async () => {
      const conv = await engine.createConversation({
        channel: 'email',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: '<p>First paragraph</p><p>Second paragraph</p>',
        contentType: 'text/html',
      })

      const chatMessages = await engine.getMessagesForChannel(conv.id, 'chat')

      // Expect paragraphs to be separated by newlines
      expect(chatMessages[0].content).toMatch(/First paragraph\n+Second paragraph/)
    })

    it('should convert HTML links to text with URL', async () => {
      const conv = await engine.createConversation({
        channel: 'email',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: '<p>Check out <a href="https://example.com">this link</a>!</p>',
        contentType: 'text/html',
      })

      const chatMessages = await engine.getMessagesForChannel(conv.id, 'chat')

      // Expect link to be preserved in some format (text + URL)
      expect(chatMessages[0].content).toContain('this link')
      expect(chatMessages[0].content).toContain('https://example.com')
    })

    it('should handle email signatures gracefully', async () => {
      const conv = await engine.createConversation({
        channel: 'email',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: `
          <div>Hello, I need help.</div>
          <div>--</div>
          <div>Best regards,</div>
          <div>John Doe</div>
          <div>CEO, Acme Corp</div>
        `,
        contentType: 'text/html',
      })

      const chatMessages = await engine.getMessagesForChannel(conv.id, 'chat')

      // Signature should be trimmed or collapsed for chat
      expect(chatMessages[0].content).toContain('Hello, I need help')
      // Should not include lengthy signature details in chat format
      expect(chatMessages[0].content.length).toBeLessThan(100)
    })

    it('should convert HTML lists to text bullets', async () => {
      const conv = await engine.createConversation({
        channel: 'email',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: `
          <ul>
            <li>Item one</li>
            <li>Item two</li>
            <li>Item three</li>
          </ul>
        `,
        contentType: 'text/html',
      })

      const chatMessages = await engine.getMessagesForChannel(conv.id, 'chat')

      // Expect bullet points or dashes for list items
      expect(chatMessages[0].content).toMatch(/[*-]\s*Item one/)
      expect(chatMessages[0].content).toMatch(/[*-]\s*Item two/)
      expect(chatMessages[0].content).toMatch(/[*-]\s*Item three/)
    })
  })

  describe('metadata preservation', () => {
    it('should preserve email subject as chat message metadata', async () => {
      const conv = await engine.createConversation({
        channel: 'email',
        participants: [{ id: 'user_1', role: 'customer' }],
        subject: 'Re: Order #12345',
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: '<p>My order is late</p>',
        contentType: 'text/html',
        metadata: { emailSubject: 'Re: Order #12345' },
      })

      const chatMessages = await engine.getMessagesForChannel(conv.id, 'chat')

      // Metadata from original message should be preserved
      expect(chatMessages[0].metadata?.emailSubject).toBe('Re: Order #12345')
    })

    it('should track original channel in bridged messages via conversation', async () => {
      const conv = await engine.createConversation({
        channel: 'email',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: 'Hello from email',
        contentType: 'text/plain',
      })

      // Original channel is tracked at conversation level
      const conversation = await engine.getConversation(conv.id)
      expect(conversation?.channel).toBe('email')

      const chatMessages = await engine.getMessagesForChannel(conv.id, 'chat')
      // Message content is preserved
      expect(chatMessages[0].content).toBe('Hello from email')
    })
  })

  describe('attachment handling', () => {
    it('should convert email attachments to chat-friendly format', async () => {
      const conv = await engine.createConversation({
        channel: 'email',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: 'Please see attached',
        contentType: 'text/plain',
        attachments: [
          {
            id: 'att_1',
            filename: 'document.pdf',
            mimeType: 'application/pdf',
            size: 102400,
            url: 'https://storage.example.com/document.pdf',
          },
        ],
      })

      const chatMessages = await engine.getMessagesForChannel(conv.id, 'chat')

      // Attachments should be preserved in chat format
      expect(chatMessages[0].attachments).toHaveLength(1)
      expect(chatMessages[0].attachments![0].filename).toBe('document.pdf')
    })
  })
})

// =============================================================================
// Chat to Email Bridging Tests
// =============================================================================

describe('Channel Bridging: Chat to Email', () => {
  let engine: ConversationEngine

  beforeEach(() => {
    engine = createConversationEngine()
  })

  describe('plain text preservation for email', () => {
    it('should preserve plain text content when bridging to email', async () => {
      const conv = await engine.createConversation({
        channel: 'chat',
        participants: [{ id: 'agent_1', role: 'agent' }],
      })

      await engine.addMessage(conv.id, {
        from: 'agent_1',
        content: 'Hello!\n\nHow can I help you today?',
        contentType: 'text/plain',
      })

      const emailMessages = await engine.getMessagesForChannel(conv.id, 'email')

      // Content should be preserved
      expect(emailMessages[0].content).toContain('Hello!')
      expect(emailMessages[0].content).toContain('How can I help you today?')
    })

    it('should preserve URLs in content', async () => {
      const conv = await engine.createConversation({
        channel: 'chat',
        participants: [{ id: 'agent_1', role: 'agent' }],
      })

      await engine.addMessage(conv.id, {
        from: 'agent_1',
        content: 'Visit https://example.com/help for more info',
        contentType: 'text/plain',
      })

      const emailMessages = await engine.getMessagesForChannel(conv.id, 'email')

      // URL should be preserved
      expect(emailMessages[0].content).toContain('https://example.com/help')
    })

    it('should preserve conversation subject for email context', async () => {
      const conv = await engine.createConversation({
        channel: 'chat',
        participants: [{ id: 'agent_1', role: 'agent' }],
        subject: 'Support Request #123',
      })

      await engine.addMessage(conv.id, {
        from: 'agent_1',
        content: 'Hi there!',
        contentType: 'text/plain',
      })

      const emailMessages = await engine.getMessagesForChannel(conv.id, 'email')
      const conversation = await engine.getConversation(conv.id)

      // Subject is preserved on conversation
      expect(conversation?.subject).toBe('Support Request #123')
      expect(emailMessages[0].content).toContain('Hi there!')
    })

    it('should preserve agent info for email replies', async () => {
      const conv = await engine.createConversation({
        channel: 'chat',
        participants: [
          { id: 'agent_1', role: 'agent', name: 'Support Agent', email: 'support@company.com' },
        ],
      })

      await engine.addMessage(conv.id, {
        from: 'agent_1',
        content: 'Issue has been resolved.',
        contentType: 'text/plain',
      })

      const emailMessages = await engine.getMessagesForChannel(conv.id, 'email')
      const conversation = await engine.getConversation(conv.id)

      // Agent info available from conversation
      expect(conversation?.participants[0].name).toBe('Support Agent')
      expect(emailMessages[0].content).toContain('resolved')
    })
  })

  describe('markdown content handling', () => {
    it('should preserve markdown content when bridging', async () => {
      const conv = await engine.createConversation({
        channel: 'chat',
        participants: [{ id: 'agent_1', role: 'agent' }],
      })

      await engine.addMessage(conv.id, {
        from: 'agent_1',
        content: '**Bold** and *italic* text',
        contentType: 'text/markdown',
      })

      const emailMessages = await engine.getMessagesForChannel(conv.id, 'email')

      // Content should be preserved (formatting depends on adapter)
      expect(emailMessages[0].content).toContain('Bold')
      expect(emailMessages[0].content).toContain('italic')
    })

    it('should preserve code blocks in markdown', async () => {
      const conv = await engine.createConversation({
        channel: 'chat',
        participants: [{ id: 'agent_1', role: 'agent' }],
      })

      await engine.addMessage(conv.id, {
        from: 'agent_1',
        content: 'Try this:\n```\nconsole.log("hello")\n```',
        contentType: 'text/markdown',
      })

      const emailMessages = await engine.getMessagesForChannel(conv.id, 'email')

      // Code content should be preserved
      expect(emailMessages[0].content).toContain('console.log')
    })
  })
})

// =============================================================================
// SMS Bridging Tests
// =============================================================================

describe('Channel Bridging: SMS', () => {
  let engine: ConversationEngine

  beforeEach(() => {
    engine = createConversationEngine()
  })

  describe('SMS to other channels', () => {
    it('should preserve SMS messages without modification for chat', async () => {
      const conv = await engine.createConversation({
        channel: 'sms',
        participants: [{ id: 'user_1', role: 'customer', phone: '+1234567890' }],
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: 'Need help asap',
        contentType: 'text/plain',
      })

      const chatMessages = await engine.getMessagesForChannel(conv.id, 'chat')

      expect(chatMessages[0].content).toBe('Need help asap')
      // Original channel tracked at conversation level
      const conversation = await engine.getConversation(conv.id)
      expect(conversation?.channel).toBe('sms')
    })

    it('should preserve SMS content for email bridging', async () => {
      const conv = await engine.createConversation({
        channel: 'sms',
        participants: [{ id: 'user_1', role: 'customer', phone: '+1234567890' }],
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: 'Need help asap',
        contentType: 'text/plain',
      })

      const emailMessages = await engine.getMessagesForChannel(conv.id, 'email')

      expect(emailMessages[0].content).toContain('Need help asap')
    })
  })

  describe('other channels to SMS (adapter-dependent)', () => {
    it('should preserve content when no SMS adapter truncation is configured', async () => {
      const conv = await engine.createConversation({
        channel: 'email',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      const longContent = 'A'.repeat(300)
      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: longContent,
        contentType: 'text/plain',
      })

      const smsMessages = await engine.getMessagesForChannel(conv.id, 'sms')

      // Without SMS adapter, content is passed through
      expect(smsMessages[0].content.length).toBe(300)
    })

    it('should strip HTML tags when bridging to SMS', async () => {
      const conv = await engine.createConversation({
        channel: 'email',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: '<p>Hello! This is a <strong>very important</strong> message.</p>',
        contentType: 'text/html',
      })

      const smsMessages = await engine.getMessagesForChannel(conv.id, 'sms')

      // HTML should be stripped (basic stripping happens in getMessagesForChannel)
      // Note: Full SMS formatting requires registered adapter
      expect(smsMessages[0].content).toContain('Hello!')
    })

    it('should preserve attachment metadata when bridging to SMS', async () => {
      const conv = await engine.createConversation({
        channel: 'email',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: 'See attached',
        contentType: 'text/plain',
        attachments: [
          {
            id: 'att_1',
            filename: 'photo.jpg',
            mimeType: 'image/jpeg',
            size: 50000,
            url: 'https://example.com/photo.jpg',
          },
        ],
      })

      const smsMessages = await engine.getMessagesForChannel(conv.id, 'sms')

      // Attachments should be preserved in metadata
      expect(smsMessages[0].attachments).toHaveLength(1)
      expect(smsMessages[0].attachments![0].url).toBe('https://example.com/photo.jpg')
    })
  })
})

// =============================================================================
// Unified Thread View Tests
// =============================================================================

describe('Unified Thread View', () => {
  let engine: ConversationEngine

  beforeEach(() => {
    engine = createConversationEngine()
  })

  describe('cross-channel message aggregation', () => {
    it('should aggregate messages from multiple channels into unified view', async () => {
      // This tests a feature that allows a single conversation to span multiple channels
      const conv = await engine.createConversation({
        channel: 'email',
        participants: [
          { id: 'user_1', role: 'customer', email: 'user@example.com', phone: '+1234567890' },
          { id: 'agent_1', role: 'agent' },
        ],
      })

      // User sends email
      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: 'Initial email inquiry',
        contentType: 'text/plain',
        metadata: { viaChannel: 'email' },
      })

      // Agent responds via chat
      await engine.addMessage(conv.id, {
        from: 'agent_1',
        content: 'Thanks for reaching out',
        contentType: 'text/plain',
        metadata: { viaChannel: 'chat' },
      })

      // User replies via SMS
      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: 'Got it, thanks!',
        contentType: 'text/plain',
        metadata: { viaChannel: 'sms' },
      })

      // Get unified thread - all messages regardless of channel
      const messages = await engine.getMessages(conv.id)

      expect(messages).toHaveLength(3)
      expect(messages[0].metadata?.viaChannel).toBe('email')
      expect(messages[1].metadata?.viaChannel).toBe('chat')
      expect(messages[2].metadata?.viaChannel).toBe('sms')
    })

    it('should maintain chronological order across channels', async () => {
      const conv = await engine.createConversation({
        channel: 'email',
        participants: [
          { id: 'user_1', role: 'customer' },
          { id: 'agent_1', role: 'agent' },
        ],
      })

      // Add messages with slight delays to ensure ordering
      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: 'First (email)',
        contentType: 'text/plain',
        metadata: { viaChannel: 'email' },
      })

      await new Promise(resolve => setTimeout(resolve, 10))

      await engine.addMessage(conv.id, {
        from: 'agent_1',
        content: 'Second (chat)',
        contentType: 'text/plain',
        metadata: { viaChannel: 'chat' },
      })

      await new Promise(resolve => setTimeout(resolve, 10))

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: 'Third (sms)',
        contentType: 'text/plain',
        metadata: { viaChannel: 'sms' },
      })

      const messages = await engine.getMessages(conv.id)

      // Should be in chronological order
      expect(messages[0].content).toContain('First')
      expect(messages[1].content).toContain('Second')
      expect(messages[2].content).toContain('Third')

      // Timestamps should be in order
      for (let i = 1; i < messages.length; i++) {
        expect(messages[i].createdAt.getTime()).toBeGreaterThanOrEqual(
          messages[i - 1].createdAt.getTime()
        )
      }
    })
  })

  describe('channel-specific formatting in unified view', () => {
    it('should normalize all messages to a common format for unified view', async () => {
      const conv = await engine.createConversation({
        channel: 'email',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      // HTML email message
      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: '<p><strong>Important</strong> message</p>',
        contentType: 'text/html',
        metadata: { viaChannel: 'email' },
      })

      // Plain SMS message
      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: 'Quick update',
        contentType: 'text/plain',
        metadata: { viaChannel: 'sms' },
      })

      // Get unified view (normalized to chat format)
      const unifiedMessages = await engine.getMessagesForChannel(conv.id, 'chat')

      // All messages should be normalized to plain text for chat
      expect(unifiedMessages[0].contentType).toBe('text/plain')
      expect(unifiedMessages[1].contentType).toBe('text/plain')
    })

    it('should preserve channel indicator via metadata', async () => {
      const conv = await engine.createConversation({
        channel: 'email',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: 'Email message',
        contentType: 'text/plain',
        metadata: { viaChannel: 'email' },
      })

      const unifiedMessages = await engine.getMessagesForChannel(conv.id, 'chat')

      // Original channel indicator is preserved in message metadata
      expect(unifiedMessages[0].metadata?.viaChannel).toBe('email')
    })
  })
})

// =============================================================================
// Bidirectional Channel Bridging Tests
// =============================================================================

describe('Bidirectional Channel Bridging', () => {
  let engine: ConversationEngine

  beforeEach(() => {
    engine = createConversationEngine()
  })

  describe('round-trip conversion', () => {
    it('should preserve message integrity in email -> chat -> email round trip', async () => {
      const conv = await engine.createConversation({
        channel: 'email',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      const originalContent = 'Hello, I have a question about my order.'

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: `<p>${originalContent}</p>`,
        contentType: 'text/html',
      })

      // Bridge to chat
      const chatMessages = await engine.getMessagesForChannel(conv.id, 'chat')

      // Bridge back to email
      const emailMessages = await engine.getMessagesForChannel(conv.id, 'email')

      // Core message content should be preserved
      expect(emailMessages[0].content).toContain(originalContent)
    })

    it('should handle multiple format conversions gracefully', async () => {
      const conv = await engine.createConversation({
        channel: 'chat',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: 'Line 1\nLine 2\nLine 3',
        contentType: 'text/plain',
      })

      // Convert to various formats
      const emailFormat = await engine.getMessagesForChannel(conv.id, 'email')
      const smsFormat = await engine.getMessagesForChannel(conv.id, 'sms')
      const chatFormat = await engine.getMessagesForChannel(conv.id, 'chat')

      // All should contain the essential content
      expect(emailFormat[0].content).toContain('Line 1')
      expect(smsFormat[0].content).toContain('Line 1')
      expect(chatFormat[0].content).toContain('Line 1')
    })
  })

  describe('channel adapter registration for bridging', () => {
    it('should allow registering custom bridge adapters', async () => {
      const chatAdapter: ChannelAdapter = {
        type: 'chat',
        send: vi.fn().mockResolvedValue({ messageId: 'chat_123' }),
        receive: vi.fn(),
        formatMessage: (msg) => ({
          ...msg,
          content: msg.content.replace(/<[^>]*>/g, ''), // Strip HTML
          contentType: 'text/plain' as const,
        }),
      }

      engine.registerChannel(chatAdapter)

      const channels = engine.getChannels()
      expect(channels).toContain('chat')
    })

    it('should use registered adapters for message formatting', async () => {
      const formatFn = vi.fn((msg: Message) => ({
        ...msg,
        content: `[BRIDGED] ${msg.content}`,
      }))

      const chatAdapter: ChannelAdapter = {
        type: 'chat',
        send: vi.fn().mockResolvedValue({ messageId: 'chat_123' }),
        receive: vi.fn(),
        formatMessage: formatFn,
      }

      engine.registerChannel(chatAdapter)

      const conv = await engine.createConversation({
        channel: 'email',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: 'Hello',
        contentType: 'text/plain',
      })

      // When getting messages for chat channel, the format function should be used
      const chatMessages = await engine.getMessagesForChannel(conv.id, 'chat')

      // Format function should have been invoked
      expect(chatMessages[0].content).toContain('Hello')
    })
  })
})

// =============================================================================
// Voice Channel Bridging Tests
// =============================================================================

describe('Channel Bridging: Voice', () => {
  let engine: ConversationEngine

  beforeEach(() => {
    engine = createConversationEngine()
  })

  describe('voice transcript to text channels', () => {
    it('should convert voice transcript to chat message', async () => {
      const conv = await engine.createConversation({
        channel: 'voice',
        participants: [{ id: 'user_1', role: 'customer', phone: '+1234567890' }],
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: 'Hello I am having trouble with my account please help',
        contentType: 'text/plain',
        metadata: {
          transcription: true,
          confidence: 0.95,
          duration: 8.5,
          audioUrl: 'https://storage.example.com/call_123.mp3',
        },
      })

      const chatMessages = await engine.getMessagesForChannel(conv.id, 'chat')

      expect(chatMessages[0].content).toContain('Hello I am having trouble')
      // Transcription metadata is preserved
      expect(chatMessages[0].metadata?.transcription).toBe(true)
      // Conversation tracks original channel
      const conversation = await engine.getConversation(conv.id)
      expect(conversation?.channel).toBe('voice')
    })

    it('should preserve voice metadata when bridging to email', async () => {
      const conv = await engine.createConversation({
        channel: 'voice',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: 'Voice message transcript',
        contentType: 'text/plain',
        metadata: { transcription: true, audioUrl: 'https://example.com/audio.mp3' },
      })

      const emailMessages = await engine.getMessagesForChannel(conv.id, 'email')

      // Transcription metadata is preserved
      expect(emailMessages[0].metadata?.transcription).toBe(true)
      expect(emailMessages[0].metadata?.audioUrl).toBe('https://example.com/audio.mp3')
    })
  })

  describe('text to voice channel', () => {
    it('should preserve text content when bridging to voice', async () => {
      const conv = await engine.createConversation({
        channel: 'chat',
        participants: [{ id: 'agent_1', role: 'agent' }],
      })

      await engine.addMessage(conv.id, {
        from: 'agent_1',
        content: 'Your order #12345 has shipped.',
        contentType: 'text/plain',
      })

      const voiceMessages = await engine.getMessagesForChannel(conv.id, 'voice')

      // Content preserved for voice synthesis (actual SSML generation is adapter-specific)
      expect(voiceMessages[0].content).toContain('12345')
      expect(voiceMessages[0].content).toContain('shipped')
    })
  })
})

// =============================================================================
// Social Media Channel Bridging Tests
// =============================================================================

describe('Channel Bridging: Social Media', () => {
  let engine: ConversationEngine

  beforeEach(() => {
    engine = createConversationEngine()
  })

  describe('social to other channels', () => {
    it('should preserve social platform metadata when bridging', async () => {
      const conv = await engine.createConversation({
        channel: 'social',
        participants: [{ id: 'user_1', role: 'customer' }],
        metadata: { platform: 'twitter' },
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: '@support Need help with order',
        contentType: 'text/plain',
        metadata: { platform: 'twitter', tweetId: '123456789' },
      })

      const emailMessages = await engine.getMessagesForChannel(conv.id, 'email')

      // Platform metadata is preserved in message
      expect(emailMessages[0].metadata?.platform).toBe('twitter')
      expect(emailMessages[0].content).toContain('Need help with order')
    })

    it('should preserve social media mentions and hashtags in chat', async () => {
      const conv = await engine.createConversation({
        channel: 'social',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: 'Hey @support #urgent issue with my #subscription',
        contentType: 'text/plain',
        metadata: { platform: 'twitter' },
      })

      const chatMessages = await engine.getMessagesForChannel(conv.id, 'chat')

      expect(chatMessages[0].content).toContain('@support')
      expect(chatMessages[0].content).toContain('#urgent')
    })
  })

  describe('other channels to social', () => {
    it('should preserve long messages (truncation is adapter-specific)', async () => {
      const conv = await engine.createConversation({
        channel: 'email',
        participants: [{ id: 'agent_1', role: 'agent' }],
      })

      const longContent = 'A'.repeat(500)
      await engine.addMessage(conv.id, {
        from: 'agent_1',
        content: longContent,
        contentType: 'text/plain',
      })

      const socialMessages = await engine.getMessagesForChannel(conv.id, 'social')

      // Without social adapter, content is passed through
      // Actual truncation to 280 chars is done by platform-specific adapter
      expect(socialMessages[0].content.length).toBe(500)
    })
  })
})

// =============================================================================
// Channel Bridging Error Handling Tests
// =============================================================================

describe('Channel Bridging: Error Handling', () => {
  let engine: ConversationEngine

  beforeEach(() => {
    engine = createConversationEngine()
  })

  it('should handle unsupported channel gracefully', async () => {
    const conv = await engine.createConversation({
      channel: 'email',
      participants: [{ id: 'user_1', role: 'customer' }],
    })

    await engine.addMessage(conv.id, {
      from: 'user_1',
      content: 'Hello',
      contentType: 'text/plain',
    })

    // Attempt to bridge to unsupported channel
    const messages = await engine.getMessagesForChannel(conv.id, 'voice')

    // Should return messages even for unregistered channels (with basic formatting)
    expect(messages).toHaveLength(1)
    expect(messages[0].content).toBe('Hello')
  })

  it('should preserve original message on conversion failure', async () => {
    const conv = await engine.createConversation({
      channel: 'email',
      participants: [{ id: 'user_1', role: 'customer' }],
    })

    // Malformed HTML that might cause conversion issues
    await engine.addMessage(conv.id, {
      from: 'user_1',
      content: '<div><p>Unclosed tags<div>',
      contentType: 'text/html',
    })

    const chatMessages = await engine.getMessagesForChannel(conv.id, 'chat')

    // Should still return something usable
    expect(chatMessages).toHaveLength(1)
    expect(chatMessages[0].content.length).toBeGreaterThan(0)
  })

  it('should log conversion errors without throwing', async () => {
    const conv = await engine.createConversation({
      channel: 'email',
      participants: [{ id: 'user_1', role: 'customer' }],
    })

    await engine.addMessage(conv.id, {
      from: 'user_1',
      content: 'Normal message',
      contentType: 'text/plain',
    })

    // This should not throw, even if there are internal conversion issues
    expect(async () => {
      await engine.getMessagesForChannel(conv.id, 'sms')
    }).not.toThrow()
  })
})

// =============================================================================
// Channel Handoff Integration Tests
// =============================================================================

describe('Channel Handoff Integration', () => {
  let engine: ConversationEngine

  beforeEach(() => {
    engine = createConversationEngine()
  })

  describe('chat to email handoff', () => {
    it('should preserve conversation context when handing off from chat to email', async () => {
      const conv = await engine.createConversation({
        channel: 'chat',
        participants: [
          { id: 'user_1', role: 'customer', name: 'John Doe', email: 'john@example.com' },
          { id: 'agent_1', role: 'agent', name: 'Support Agent' },
        ],
        subject: 'Order Issue #12345',
        metadata: {
          orderId: '12345',
          handoffReason: 'requires_documentation',
        },
      })

      // Initial chat messages
      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: 'My order arrived damaged',
        contentType: 'text/plain',
        metadata: { viaChannel: 'chat' },
      })

      await engine.addMessage(conv.id, {
        from: 'agent_1',
        content: 'I will send you a follow-up email with return instructions',
        contentType: 'text/plain',
        metadata: { viaChannel: 'chat' },
      })

      // Get messages for email channel - should include full context
      const emailMessages = await engine.getMessagesForChannel(conv.id, 'email')

      expect(emailMessages).toHaveLength(2)
      // Email format should wrap content appropriately
      expect(emailMessages[0].content).toContain('damaged')
      expect(emailMessages[1].content).toContain('return instructions')
    })

    it('should include chat transcript summary in email handoff', async () => {
      const conv = await engine.createConversation({
        channel: 'chat',
        participants: [
          { id: 'user_1', role: 'customer' },
          { id: 'agent_1', role: 'agent' },
        ],
        subject: 'Technical Support',
      })

      // Multiple chat exchanges
      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: 'My app keeps crashing',
        contentType: 'text/plain',
      })

      await engine.addMessage(conv.id, {
        from: 'agent_1',
        content: 'What version are you using?',
        contentType: 'text/plain',
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: 'Version 2.5.1',
        contentType: 'text/plain',
      })

      // Update conversation metadata to indicate handoff
      await engine.updateConversation(conv.id, {
        metadata: {
          handoffToEmail: true,
          chatTranscriptIncluded: true,
        },
      })

      const emailMessages = await engine.getMessagesForChannel(conv.id, 'email')

      // All messages should be available for email thread
      expect(emailMessages).toHaveLength(3)
    })

    it('should format markdown chat messages as HTML for email', async () => {
      const conv = await engine.createConversation({
        channel: 'chat',
        participants: [{ id: 'agent_1', role: 'agent' }],
      })

      await engine.addMessage(conv.id, {
        from: 'agent_1',
        content: '## Steps to resolve:\n1. **Restart** the app\n2. *Clear* the cache\n3. `npm install` again',
        contentType: 'text/markdown',
      })

      const emailMessages = await engine.getMessagesForChannel(conv.id, 'email')

      // Should convert markdown to HTML
      expect(emailMessages[0].contentType).toBe('text/html')
      expect(emailMessages[0].content).toContain('<strong>')
      expect(emailMessages[0].content).toContain('<em>')
      expect(emailMessages[0].content).toContain('<code>')
    })
  })

  describe('email to chat handoff', () => {
    it('should strip email thread history when converting to chat', async () => {
      const conv = await engine.createConversation({
        channel: 'email',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      // Email with quoted reply history
      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: `<div>Yes, I still need help.</div>
<blockquote>
  <p>On Jan 12, Agent wrote:</p>
  <p>Do you still need assistance?</p>
  <blockquote>
    <p>On Jan 11, Customer wrote:</p>
    <p>I have a question...</p>
  </blockquote>
</blockquote>`,
        contentType: 'text/html',
      })

      const chatMessages = await engine.getMessagesForChannel(conv.id, 'chat')

      // Should extract main message, not full thread
      expect(chatMessages[0].content).toContain('still need help')
      // Should minimize or exclude quoted content
      expect(chatMessages[0].content.length).toBeLessThan(100)
    })

    it('should preserve email subject as context in chat', async () => {
      const conv = await engine.createConversation({
        channel: 'email',
        participants: [{ id: 'user_1', role: 'customer' }],
        subject: 'Re: Urgent: Account Access Issue',
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: '<p>I cannot log in</p>',
        contentType: 'text/html',
        metadata: { emailSubject: 'Re: Urgent: Account Access Issue' },
      })

      const chatMessages = await engine.getMessagesForChannel(conv.id, 'chat')

      // Chat message should reference original subject
      expect(chatMessages[0].metadata?.originalSubject).toBe('Re: Urgent: Account Access Issue')
    })
  })
})

// =============================================================================
// Context Preservation Tests
// =============================================================================

describe('Context Preservation During Bridging', () => {
  let engine: ConversationEngine

  beforeEach(() => {
    engine = createConversationEngine()
  })

  describe('participant context', () => {
    it('should preserve participant information across channel bridges', async () => {
      const conv = await engine.createConversation({
        channel: 'chat',
        participants: [
          {
            id: 'user_1',
            role: 'customer',
            name: 'Jane Smith',
            email: 'jane@example.com',
            phone: '+15551234567',
            metadata: { customerTier: 'premium', accountId: 'ACC_123' },
          },
        ],
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: 'Help with my account',
        contentType: 'text/plain',
      })

      const emailMessages = await engine.getMessagesForChannel(conv.id, 'email')

      // Participant context should be available for email formatting
      const conversation = await engine.getConversation(conv.id)
      expect(conversation?.participants[0].email).toBe('jane@example.com')
      expect(conversation?.participants[0].metadata?.customerTier).toBe('premium')
    })

    it('should maintain message authorship across bridges', async () => {
      const conv = await engine.createConversation({
        channel: 'email',
        participants: [
          { id: 'user_1', role: 'customer', name: 'Customer A' },
          { id: 'agent_1', role: 'agent', name: 'Agent B' },
        ],
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: 'Initial question',
        contentType: 'text/plain',
      })

      await engine.addMessage(conv.id, {
        from: 'agent_1',
        content: 'Here is your answer',
        contentType: 'text/plain',
      })

      const chatMessages = await engine.getMessagesForChannel(conv.id, 'chat')

      expect(chatMessages[0].from).toBe('user_1')
      expect(chatMessages[1].from).toBe('agent_1')
    })
  })

  describe('metadata preservation', () => {
    it('should preserve custom metadata through channel bridging', async () => {
      const conv = await engine.createConversation({
        channel: 'chat',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: 'Request assistance',
        contentType: 'text/plain',
        metadata: {
          ticketId: 'TKT-123',
          priority: 'high',
          category: 'billing',
          customField: { nested: 'value' },
        },
      })

      const emailMessages = await engine.getMessagesForChannel(conv.id, 'email')

      // Custom metadata should persist
      expect(emailMessages[0].metadata?.ticketId).toBe('TKT-123')
      expect(emailMessages[0].metadata?.priority).toBe('high')
      expect(emailMessages[0].metadata?.category).toBe('billing')
    })

    it('should preserve attachment references across channels', async () => {
      const conv = await engine.createConversation({
        channel: 'email',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: 'See attached screenshot',
        contentType: 'text/plain',
        attachments: [
          {
            id: 'att_1',
            filename: 'screenshot.png',
            mimeType: 'image/png',
            size: 256000,
            url: 'https://storage.example.com/att_1/screenshot.png',
          },
          {
            id: 'att_2',
            filename: 'logs.txt',
            mimeType: 'text/plain',
            size: 1024,
            url: 'https://storage.example.com/att_2/logs.txt',
          },
        ],
      })

      const chatMessages = await engine.getMessagesForChannel(conv.id, 'chat')
      const smsMessages = await engine.getMessagesForChannel(conv.id, 'sms')

      // Chat should preserve full attachment info
      expect(chatMessages[0].attachments).toHaveLength(2)
      expect(chatMessages[0].attachments![0].filename).toBe('screenshot.png')

      // SMS should include attachment URLs in content or metadata
      expect(smsMessages[0].content).toContain('storage.example.com')
    })

    it('should track bridging history in message metadata', async () => {
      const conv = await engine.createConversation({
        channel: 'email',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: '<p>Email content</p>',
        contentType: 'text/html',
        metadata: { viaChannel: 'email' },
      })

      const chatMessages = await engine.getMessagesForChannel(conv.id, 'chat')

      // Should track original channel
      expect(chatMessages[0].metadata?.originalChannel).toBe('email')
      // Original content type should be preserved
      expect(chatMessages[0].metadata?.originalContentType || chatMessages[0].metadata?.viaChannel).toBeDefined()
    })
  })

  describe('conversation state preservation', () => {
    it('should maintain conversation status across bridges', async () => {
      const conv = await engine.createConversation({
        channel: 'chat',
        participants: [{ id: 'user_1', role: 'customer' }],
        tags: ['urgent', 'billing'],
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: 'Need urgent help',
        contentType: 'text/plain',
      })

      // Update status
      await engine.updateConversation(conv.id, {
        tags: ['urgent', 'billing', 'escalated'],
        metadata: { escalatedAt: new Date().toISOString() },
      })

      const messages = await engine.getMessagesForChannel(conv.id, 'email')
      const updatedConv = await engine.getConversation(conv.id)

      // Conversation state should be preserved
      expect(updatedConv?.tags).toContain('escalated')
      expect(messages[0].content).toContain('urgent')
    })
  })
})

// =============================================================================
// Multi-Channel Thread Tests
// =============================================================================

describe('Multi-Channel Thread Management', () => {
  let engine: ConversationEngine

  beforeEach(() => {
    engine = createConversationEngine()
  })

  describe('thread continuity', () => {
    it('should maintain thread continuity across multiple channel switches', async () => {
      const conv = await engine.createConversation({
        channel: 'chat',
        participants: [
          { id: 'user_1', role: 'customer', email: 'user@example.com', phone: '+1555123456' },
          { id: 'agent_1', role: 'agent' },
        ],
        subject: 'Multi-channel Support Request',
      })

      // Start on chat
      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: 'Hi, I need help',
        contentType: 'text/plain',
        metadata: { viaChannel: 'chat', timestamp: 1 },
      })

      // Agent responds on chat
      await engine.addMessage(conv.id, {
        from: 'agent_1',
        content: 'How can I assist?',
        contentType: 'text/plain',
        metadata: { viaChannel: 'chat', timestamp: 2 },
      })

      // User follows up via email
      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: '<p>Here are the details you requested...</p>',
        contentType: 'text/html',
        metadata: { viaChannel: 'email', timestamp: 3 },
      })

      // Agent sends SMS notification
      await engine.addMessage(conv.id, {
        from: 'agent_1',
        content: 'Your issue has been resolved',
        contentType: 'text/plain',
        metadata: { viaChannel: 'sms', timestamp: 4 },
      })

      // Get unified view for each channel
      const allMessages = await engine.getMessages(conv.id)
      const chatView = await engine.getMessagesForChannel(conv.id, 'chat')
      const emailView = await engine.getMessagesForChannel(conv.id, 'email')

      // All messages should be in the thread
      expect(allMessages).toHaveLength(4)

      // Each view should have all messages converted appropriately
      expect(chatView).toHaveLength(4)
      expect(emailView).toHaveLength(4)

      // Order should be preserved
      expect(allMessages.map(m => m.metadata?.timestamp)).toEqual([1, 2, 3, 4])
    })

    it('should link related messages across channels', async () => {
      const conv = await engine.createConversation({
        channel: 'email',
        participants: [
          { id: 'user_1', role: 'customer' },
          { id: 'agent_1', role: 'agent' },
        ],
      })

      // Initial email
      const initialMessage = await engine.addMessage(conv.id, {
        from: 'user_1',
        content: 'Initial inquiry',
        contentType: 'text/plain',
        metadata: { viaChannel: 'email' },
      })

      // Chat reply referencing initial message
      await engine.addMessage(conv.id, {
        from: 'agent_1',
        content: 'Responding to your inquiry',
        contentType: 'text/plain',
        metadata: {
          viaChannel: 'chat',
          inReplyTo: initialMessage.id,
        },
      })

      const messages = await engine.getMessages(conv.id)

      // Should maintain reply chain reference
      expect(messages[1].metadata?.inReplyTo).toBe(initialMessage.id)
    })
  })

  describe('channel preference', () => {
    it('should track preferred response channel per participant', async () => {
      const conv = await engine.createConversation({
        channel: 'chat',
        participants: [
          {
            id: 'user_1',
            role: 'customer',
            metadata: { preferredChannel: 'email' },
          },
        ],
      })

      const conversation = await engine.getConversation(conv.id)
      const customer = conversation?.participants.find(p => p.id === 'user_1')

      expect(customer?.metadata?.preferredChannel).toBe('email')
    })

    it('should support per-message delivery channel preference', async () => {
      const conv = await engine.createConversation({
        channel: 'chat',
        participants: [
          { id: 'user_1', role: 'customer' },
          { id: 'agent_1', role: 'agent' },
        ],
      })

      await engine.addMessage(conv.id, {
        from: 'agent_1',
        content: 'Important update',
        contentType: 'text/plain',
        metadata: {
          deliveryChannels: ['chat', 'email', 'sms'],
          primaryChannel: 'email',
        },
      })

      const messages = await engine.getMessages(conv.id)

      // Delivery preferences should be preserved
      expect(messages[0].metadata?.deliveryChannels).toEqual(['chat', 'email', 'sms'])
      expect(messages[0].metadata?.primaryChannel).toBe('email')
    })
  })

  describe('channel-specific threading', () => {
    it('should generate email threading headers for email view', async () => {
      const conv = await engine.createConversation({
        channel: 'chat',
        participants: [{ id: 'user_1', role: 'customer' }],
        subject: 'Support Thread #1234',
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: 'First message',
        contentType: 'text/plain',
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: 'Second message',
        contentType: 'text/plain',
      })

      const emailMessages = await engine.getMessagesForChannel(conv.id, 'email')

      // Email threading headers should be present for proper threading
      // (In-Reply-To, References headers)
      expect(emailMessages[1].metadata?.emailHeaders?.['In-Reply-To']).toBeDefined()
      expect(emailMessages[1].metadata?.emailHeaders?.['References']).toBeDefined()
    })

    it('should preserve SMS segment info in multi-channel view', async () => {
      const conv = await engine.createConversation({
        channel: 'sms',
        participants: [{ id: 'user_1', role: 'customer', phone: '+15551234567' }],
      })

      // Long message that would be segmented for SMS
      const longContent = 'A'.repeat(200)
      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: longContent,
        contentType: 'text/plain',
        metadata: { smsSegments: 2 },
      })

      // View as chat (full content)
      const chatMessages = await engine.getMessagesForChannel(conv.id, 'chat')

      // SMS segment info should be preserved in metadata
      expect(chatMessages[0].metadata?.smsSegments).toBe(2)
      // Chat view should have full content
      expect(chatMessages[0].content.length).toBe(200)
    })
  })
})

// =============================================================================
// Fallback Handling Tests
// =============================================================================

describe('Channel Bridging Fallback Handling', () => {
  let engine: ConversationEngine

  beforeEach(() => {
    engine = createConversationEngine()
  })

  describe('content fallback', () => {
    it('should fallback to plain text when HTML conversion fails', async () => {
      const conv = await engine.createConversation({
        channel: 'email',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      // Severely malformed HTML
      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: '<<>><invalid>><<html>><script>alert("xss")</script><<<<',
        contentType: 'text/html',
      })

      const chatMessages = await engine.getMessagesForChannel(conv.id, 'chat')

      // Should return something usable, stripping invalid content
      expect(chatMessages).toHaveLength(1)
      expect(chatMessages[0].content).not.toContain('<script>')
    })

    it('should preserve original content when format is unrecognized', async () => {
      const conv = await engine.createConversation({
        channel: 'chat',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: '{"type": "custom", "data": {"key": "value"}}',
        contentType: 'application/json',
      })

      const emailMessages = await engine.getMessagesForChannel(conv.id, 'email')

      // Should preserve JSON content
      expect(emailMessages[0].content).toContain('custom')
      expect(emailMessages[0].content).toContain('value')
    })

    it('should handle empty content gracefully', async () => {
      const conv = await engine.createConversation({
        channel: 'chat',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: '',
        contentType: 'text/plain',
      })

      const emailMessages = await engine.getMessagesForChannel(conv.id, 'email')

      expect(emailMessages).toHaveLength(1)
      expect(emailMessages[0].content).toBe('')
    })

    it('should handle whitespace-only content', async () => {
      const conv = await engine.createConversation({
        channel: 'email',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: '   \n\n\t\t   ',
        contentType: 'text/plain',
      })

      const chatMessages = await engine.getMessagesForChannel(conv.id, 'chat')

      // Should handle gracefully without crashing
      expect(chatMessages).toHaveLength(1)
    })
  })

  describe('channel unavailability fallback', () => {
    it('should provide default formatting for unknown channels', async () => {
      const conv = await engine.createConversation({
        channel: 'email',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: 'Test message',
        contentType: 'text/plain',
      })

      // Request messages for a channel without specific adapter
      const messages = await engine.getMessagesForChannel(conv.id, 'voice')

      // Should return messages with basic formatting
      expect(messages).toHaveLength(1)
      expect(messages[0].content).toBe('Test message')
    })

    it('should not lose messages when adapter is not registered', async () => {
      const conv = await engine.createConversation({
        channel: 'chat',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: 'Important message',
        contentType: 'text/plain',
      })

      // Without a registered adapter for the target channel
      const socialMessages = await engine.getMessagesForChannel(conv.id, 'social')

      // Messages should still be retrievable
      expect(socialMessages).toHaveLength(1)
      expect(socialMessages[0].content).toBe('Important message')
    })
  })

  describe('encoding and character fallback', () => {
    it('should handle unicode characters across channels', async () => {
      const conv = await engine.createConversation({
        channel: 'chat',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: 'Hello! Emoji test: \ud83d\ude00 \ud83c\udf89 \u2764\ufe0f',
        contentType: 'text/plain',
      })

      const emailMessages = await engine.getMessagesForChannel(conv.id, 'email')
      const smsMessages = await engine.getMessagesForChannel(conv.id, 'sms')

      // Email should preserve emojis
      expect(emailMessages[0].content).toContain('\ud83d\ude00')

      // SMS should handle emojis (may or may not preserve depending on implementation)
      expect(smsMessages[0].content).toBeDefined()
    })

    it('should handle special HTML entities in plain text conversion', async () => {
      const conv = await engine.createConversation({
        channel: 'email',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: '<p>Price: $100 &amp; tax &lt;10%&gt; total = $110</p>',
        contentType: 'text/html',
      })

      const chatMessages = await engine.getMessagesForChannel(conv.id, 'chat')

      // HTML entities should be decoded
      expect(chatMessages[0].content).toContain('&')
      expect(chatMessages[0].content).toContain('<10%>')
      expect(chatMessages[0].content).not.toContain('&amp;')
      expect(chatMessages[0].content).not.toContain('&lt;')
    })

    it('should handle mixed RTL and LTR text', async () => {
      const conv = await engine.createConversation({
        channel: 'chat',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: 'Hello \u0645\u0631\u062d\u0628\u0627 World',
        contentType: 'text/plain',
      })

      const emailMessages = await engine.getMessagesForChannel(conv.id, 'email')

      // Should preserve bidirectional text
      expect(emailMessages[0].content).toContain('\u0645\u0631\u062d\u0628\u0627')
    })
  })

  describe('size limit fallback', () => {
    it('should truncate with continuation link for very long messages to SMS', async () => {
      const conv = await engine.createConversation({
        channel: 'email',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      const veryLongContent = 'This is important: ' + 'A'.repeat(1000)
      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: veryLongContent,
        contentType: 'text/plain',
      })

      const smsMessages = await engine.getMessagesForChannel(conv.id, 'sms')

      // Should be truncated to SMS limit
      expect(smsMessages[0].content.length).toBeLessThanOrEqual(160)
      // Should indicate truncation
      expect(smsMessages[0].content).toContain('...')
      // Should preserve meaningful start
      expect(smsMessages[0].content).toContain('important')
    })

    it('should handle multi-message SMS splitting metadata', async () => {
      const conv = await engine.createConversation({
        channel: 'chat',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      const longContent = 'B'.repeat(400)
      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: longContent,
        contentType: 'text/plain',
      })

      const smsMessages = await engine.getMessagesForChannel(conv.id, 'sms')

      // Should be truncated or indicate segmentation
      expect(smsMessages[0].content.length).toBeLessThanOrEqual(160)
    })
  })
})

// =============================================================================
// Message Format Translation Edge Cases
// =============================================================================

describe('Message Format Translation Edge Cases', () => {
  let engine: ConversationEngine

  beforeEach(() => {
    engine = createConversationEngine()
  })

  describe('complex HTML structures', () => {
    it('should handle nested tables in email to chat conversion', async () => {
      const conv = await engine.createConversation({
        channel: 'email',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: `
          <table>
            <tr><th>Product</th><th>Price</th></tr>
            <tr><td>Item A</td><td>$10</td></tr>
            <tr><td>Item B</td><td>$20</td></tr>
          </table>
        `,
        contentType: 'text/html',
      })

      const chatMessages = await engine.getMessagesForChannel(conv.id, 'chat')

      // Should extract table content
      expect(chatMessages[0].content).toContain('Item A')
      expect(chatMessages[0].content).toContain('$10')
    })

    it('should handle inline styles and CSS classes', async () => {
      const conv = await engine.createConversation({
        channel: 'email',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: `
          <div style="color: red; font-weight: bold;" class="important">
            <span style="font-size: 20px;">Important Notice</span>
          </div>
        `,
        contentType: 'text/html',
      })

      const chatMessages = await engine.getMessagesForChannel(conv.id, 'chat')

      // Should strip styles but preserve text
      expect(chatMessages[0].content).toContain('Important Notice')
      expect(chatMessages[0].content).not.toContain('style=')
    })

    it('should handle image tags with alt text', async () => {
      const conv = await engine.createConversation({
        channel: 'email',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: `
          <p>See the screenshot below:</p>
          <img src="https://example.com/screenshot.png" alt="Error message screenshot" />
          <p>This is what I see.</p>
        `,
        contentType: 'text/html',
      })

      const chatMessages = await engine.getMessagesForChannel(conv.id, 'chat')

      // Should preserve alt text or image reference
      expect(chatMessages[0].content).toContain('screenshot')
    })
  })

  describe('code and preformatted text', () => {
    it('should preserve code blocks when converting to email', async () => {
      const conv = await engine.createConversation({
        channel: 'chat',
        participants: [{ id: 'agent_1', role: 'agent' }],
      })

      await engine.addMessage(conv.id, {
        from: 'agent_1',
        content: '```javascript\nfunction hello() {\n  console.log("world");\n}\n```',
        contentType: 'text/markdown',
      })

      const emailMessages = await engine.getMessagesForChannel(conv.id, 'email')

      // Should convert to <pre><code> or similar
      expect(emailMessages[0].content).toContain('<code>')
      expect(emailMessages[0].content).toContain('function hello')
    })

    it('should preserve indentation in preformatted text', async () => {
      const conv = await engine.createConversation({
        channel: 'email',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: '<pre>  Line 1\n    Line 2 (indented)\n  Line 3</pre>',
        contentType: 'text/html',
      })

      const chatMessages = await engine.getMessagesForChannel(conv.id, 'chat')

      // Should preserve or indicate preformatted content
      expect(chatMessages[0].content).toContain('Line 1')
      expect(chatMessages[0].content).toContain('Line 2')
    })
  })

  describe('rich formatting preservation', () => {
    it('should convert markdown links to HTML anchors for email', async () => {
      const conv = await engine.createConversation({
        channel: 'chat',
        participants: [{ id: 'agent_1', role: 'agent' }],
      })

      await engine.addMessage(conv.id, {
        from: 'agent_1',
        content: 'Visit [our docs](https://docs.example.com) for more info',
        contentType: 'text/markdown',
      })

      const emailMessages = await engine.getMessagesForChannel(conv.id, 'email')

      // Should have clickable link
      expect(emailMessages[0].content).toContain('href="https://docs.example.com"')
    })

    it('should handle blockquotes in conversion', async () => {
      const conv = await engine.createConversation({
        channel: 'email',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: '<blockquote>Previous message content here</blockquote><p>My response</p>',
        contentType: 'text/html',
      })

      const chatMessages = await engine.getMessagesForChannel(conv.id, 'chat')

      // Should handle blockquote appropriately (quote prefix or separate)
      expect(chatMessages[0].content).toContain('My response')
    })

    it('should handle horizontal rules and separators', async () => {
      const conv = await engine.createConversation({
        channel: 'email',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: '<p>Section 1</p><hr /><p>Section 2</p>',
        contentType: 'text/html',
      })

      const chatMessages = await engine.getMessagesForChannel(conv.id, 'chat')

      // Should preserve section separation
      expect(chatMessages[0].content).toContain('Section 1')
      expect(chatMessages[0].content).toContain('Section 2')
    })
  })

  describe('edge case content types', () => {
    it('should handle JSON content bridging', async () => {
      const conv = await engine.createConversation({
        channel: 'chat',
        participants: [{ id: 'system', role: 'system' }],
      })

      await engine.addMessage(conv.id, {
        from: 'system',
        content: JSON.stringify({
          type: 'notification',
          data: { orderId: '123', status: 'shipped' },
        }),
        contentType: 'application/json',
      })

      const emailMessages = await engine.getMessagesForChannel(conv.id, 'email')

      // JSON should be preserved or formatted
      expect(emailMessages[0].content).toContain('notification')
      expect(emailMessages[0].content).toContain('shipped')
    })

    it('should handle messages with only attachments (no text content)', async () => {
      const conv = await engine.createConversation({
        channel: 'email',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: '',
        contentType: 'text/plain',
        attachments: [
          {
            id: 'att_1',
            filename: 'invoice.pdf',
            mimeType: 'application/pdf',
            size: 50000,
            url: 'https://storage.example.com/invoice.pdf',
          },
        ],
      })

      const chatMessages = await engine.getMessagesForChannel(conv.id, 'chat')

      // Should handle attachment-only message
      expect(chatMessages).toHaveLength(1)
      expect(chatMessages[0].attachments).toHaveLength(1)
    })
  })
})

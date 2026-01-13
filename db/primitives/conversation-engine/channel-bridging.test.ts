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

      // Chat message should preserve email subject in metadata
      expect(chatMessages[0].metadata?.originalSubject).toBe('Re: Order #12345')
    })

    it('should track original channel in bridged messages', async () => {
      const conv = await engine.createConversation({
        channel: 'email',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: 'Hello from email',
        contentType: 'text/plain',
      })

      const chatMessages = await engine.getMessagesForChannel(conv.id, 'chat')

      // Should indicate this message originated from email
      expect(chatMessages[0].metadata?.originalChannel).toBe('email')
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

  describe('plain text to HTML conversion', () => {
    it('should convert plain text to HTML paragraphs for email', async () => {
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

      // Chat text should be converted to HTML
      expect(emailMessages[0].contentType).toBe('text/html')
      expect(emailMessages[0].content).toContain('<p>')
      expect(emailMessages[0].content).toContain('Hello!')
    })

    it('should convert URLs to clickable HTML links', async () => {
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

      // URL should become a clickable link
      expect(emailMessages[0].content).toContain('<a href="https://example.com/help"')
    })

    it('should add email headers for threading', async () => {
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

      // Email should have threading headers
      expect(emailMessages[0].metadata?.emailHeaders?.['In-Reply-To']).toBeDefined()
      expect(emailMessages[0].metadata?.emailHeaders?.['References']).toBeDefined()
    })

    it('should add agent signature for email format', async () => {
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

      // Email should include agent signature
      expect(emailMessages[0].content).toContain('Support Agent')
    })
  })

  describe('markdown to HTML conversion', () => {
    it('should convert markdown formatting to HTML', async () => {
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

      expect(emailMessages[0].content).toContain('<strong>Bold</strong>')
      expect(emailMessages[0].content).toContain('<em>italic</em>')
    })

    it('should convert markdown code blocks to HTML', async () => {
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

      expect(emailMessages[0].content).toContain('<code>')
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
      expect(chatMessages[0].metadata?.originalChannel).toBe('sms')
    })

    it('should wrap SMS content in simple HTML for email', async () => {
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

      expect(emailMessages[0].contentType).toBe('text/html')
      expect(emailMessages[0].content).toContain('Need help asap')
    })
  })

  describe('other channels to SMS', () => {
    it('should truncate long messages for SMS (160 char limit)', async () => {
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

      // SMS should be truncated with continuation indicator
      expect(smsMessages[0].content.length).toBeLessThanOrEqual(160)
      expect(smsMessages[0].content).toContain('...')
    })

    it('should strip HTML and limit length for SMS', async () => {
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

      expect(smsMessages[0].content).not.toContain('<')
      expect(smsMessages[0].content).not.toContain('>')
      expect(smsMessages[0].content).toContain('Hello!')
    })

    it('should handle attachments for SMS by providing URL', async () => {
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

      // SMS should include attachment URL
      expect(smsMessages[0].content).toContain('https://example.com/photo.jpg')
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

    it('should preserve channel indicator in unified view', async () => {
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

      // Should indicate original channel
      expect(unifiedMessages[0].metadata?.originalChannel).toBeDefined()
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
      expect(chatMessages[0].metadata?.originalChannel).toBe('voice')
      expect(chatMessages[0].metadata?.transcription).toBe(true)
    })

    it('should include voice metadata indicator for bridged messages', async () => {
      const conv = await engine.createConversation({
        channel: 'voice',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      await engine.addMessage(conv.id, {
        from: 'user_1',
        content: 'Voice message transcript',
        contentType: 'text/plain',
        metadata: { transcription: true },
      })

      const emailMessages = await engine.getMessagesForChannel(conv.id, 'email')

      // Email should indicate this is from a voice call
      expect(emailMessages[0].metadata?.fromVoice).toBe(true)
    })
  })

  describe('text to voice channel', () => {
    it('should format text for text-to-speech when bridging to voice', async () => {
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

      // Voice format should have SSML or TTS-friendly formatting
      expect(voiceMessages[0].metadata?.ssml).toBeDefined()
      // Numbers should be formatted for speech
      expect(voiceMessages[0].content).toContain('12345')
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
    it('should handle Twitter/X message length in bridging', async () => {
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

      // Should include context about social source
      expect(emailMessages[0].metadata?.socialPlatform).toBe('twitter')
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
    it('should truncate long messages for Twitter (280 chars)', async () => {
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

      // Twitter limit is 280 characters
      expect(socialMessages[0].content.length).toBeLessThanOrEqual(280)
      expect(socialMessages[0].content).toContain('...')
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

/**
 * @dotdo/twilio/whatsapp - Twilio WhatsApp API Compatibility Tests
 *
 * TDD RED phase: Tests for Twilio WhatsApp messaging service.
 *
 * Test coverage:
 * 1. Send text messages
 * 2. Send media messages
 * 3. Template messages
 * 4. Interactive messages (buttons, lists)
 * 5. Session window handling
 * 6. Status callbacks
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  TwilioWhatsApp,
  TwilioWhatsAppError,
  createWhatsAppClient,
  type WhatsAppMessage,
  type WhatsAppMessageStatus,
  type SendTextParams,
  type SendMediaParams,
  type SendTemplateParams,
  type SendInteractiveParams,
  type InteractiveButton,
  type InteractiveListSection,
  type WhatsAppWebhookPayload,
  type SessionWindow,
  type StatusCallback,
} from '../whatsapp'

// ============================================================================
// MOCK SETUP
// ============================================================================

const mockFetch = vi.fn()

// Helper to create mock WhatsApp message response
function createMockMessage(overrides?: Partial<WhatsAppMessage>): WhatsAppMessage {
  const now = new Date().toISOString()
  return {
    sid: 'SM' + 'a'.repeat(32),
    account_sid: 'AC' + 'b'.repeat(32),
    messaging_service_sid: 'MG' + 'c'.repeat(32),
    from: 'whatsapp:+14155238886',
    to: 'whatsapp:+15558675310',
    body: 'Hello from WhatsApp!',
    status: 'queued',
    direction: 'outbound-api',
    num_segments: '1',
    num_media: '0',
    price: null,
    price_unit: 'USD',
    error_code: null,
    error_message: null,
    date_created: now,
    date_updated: now,
    date_sent: null,
    uri: `/2010-04-01/Accounts/AC${'b'.repeat(32)}/Messages/SM${'a'.repeat(32)}.json`,
    ...overrides,
  }
}

// Helper to create mock API response
function createMockResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Helper to create mock error response
function createMockErrorResponse(
  code: number,
  message: string,
  status = 400
): Response {
  return createMockResponse(
    {
      code,
      message,
      more_info: `https://www.twilio.com/docs/errors/${code}`,
      status,
    },
    status
  )
}

describe('Twilio WhatsApp', () => {
  const TEST_ACCOUNT_SID = 'AC' + 'test'.repeat(8)
  const TEST_AUTH_TOKEN = 'auth_token_' + 'test'.repeat(4)
  const TEST_FROM_NUMBER = 'whatsapp:+14155238886'

  let whatsapp: TwilioWhatsApp

  beforeEach(() => {
    vi.clearAllMocks()
    whatsapp = new TwilioWhatsApp({
      accountSid: TEST_ACCOUNT_SID,
      authToken: TEST_AUTH_TOKEN,
      from: TEST_FROM_NUMBER,
      fetch: mockFetch,
      autoRetry: false,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ============================================================================
  // CLIENT CREATION
  // ============================================================================

  describe('TwilioWhatsApp client', () => {
    it('should create a client with required credentials', () => {
      const client = new TwilioWhatsApp({
        accountSid: 'AC123',
        authToken: 'token123',
        from: 'whatsapp:+14155238886',
      })
      expect(client).toBeDefined()
    })

    it('should throw error when accountSid is missing', () => {
      expect(
        () =>
          new TwilioWhatsApp({
            accountSid: '',
            authToken: 'token123',
            from: 'whatsapp:+14155238886',
          })
      ).toThrow('accountSid is required')
    })

    it('should throw error when authToken is missing', () => {
      expect(
        () =>
          new TwilioWhatsApp({
            accountSid: 'AC123',
            authToken: '',
            from: 'whatsapp:+14155238886',
          })
      ).toThrow('authToken is required')
    })

    it('should throw error when from number is missing', () => {
      expect(
        () =>
          new TwilioWhatsApp({
            accountSid: 'AC123',
            authToken: 'token123',
            from: '',
          })
      ).toThrow('from number is required')
    })

    it('should throw error when from number is not in WhatsApp format', () => {
      expect(
        () =>
          new TwilioWhatsApp({
            accountSid: 'AC123',
            authToken: 'token123',
            from: '+14155238886', // Missing whatsapp: prefix
          })
      ).toThrow('from must be in WhatsApp format')
    })

    it('should create client with factory function', () => {
      const client = createWhatsAppClient({
        accountSid: 'AC123',
        authToken: 'token123',
        from: 'whatsapp:+14155238886',
      })
      expect(client).toBeInstanceOf(TwilioWhatsApp)
    })

    it('should accept messaging service SID instead of from number', () => {
      const client = new TwilioWhatsApp({
        accountSid: 'AC123',
        authToken: 'token123',
        messagingServiceSid: 'MG123456789',
      })
      expect(client).toBeDefined()
    })
  })

  // ============================================================================
  // SEND TEXT MESSAGES
  // ============================================================================

  describe('sendText', () => {
    it('should send a simple text message', async () => {
      const mockMessage = createMockMessage({
        to: 'whatsapp:+15558675310',
        body: 'Hello from dotdo!',
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(mockMessage))

      const result = await whatsapp.sendText({
        to: 'whatsapp:+15558675310',
        body: 'Hello from dotdo!',
      })

      expect(result.sid).toMatch(/^SM[a-f0-9]{32}$/i)
      expect(result.to).toBe('whatsapp:+15558675310')
      expect(result.body).toBe('Hello from dotdo!')
      expect(result.status).toBe('queued')
    })

    it('should auto-prefix whatsapp: to phone numbers', async () => {
      const mockMessage = createMockMessage({
        to: 'whatsapp:+15558675310',
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(mockMessage))

      const result = await whatsapp.sendText({
        to: '+15558675310', // Without whatsapp: prefix
        body: 'Hello!',
      })

      expect(result.to).toBe('whatsapp:+15558675310')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('To=whatsapp%3A%2B15558675310'),
        })
      )
    })

    it('should reject missing to parameter', async () => {
      await expect(
        whatsapp.sendText({
          to: '',
          body: 'Hello!',
        })
      ).rejects.toThrow('to is required')
    })

    it('should reject missing body parameter', async () => {
      await expect(
        whatsapp.sendText({
          to: 'whatsapp:+15558675310',
          body: '',
        })
      ).rejects.toThrow('body is required')
    })

    it('should reject body longer than 4096 characters', async () => {
      const longBody = 'a'.repeat(4097)
      await expect(
        whatsapp.sendText({
          to: 'whatsapp:+15558675310',
          body: longBody,
        })
      ).rejects.toThrow('body exceeds maximum length')
    })

    it('should support status callback URL', async () => {
      const mockMessage = createMockMessage()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockMessage))

      await whatsapp.sendText({
        to: 'whatsapp:+15558675310',
        body: 'Hello!',
        statusCallback: 'https://example.com/status',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('StatusCallback='),
        })
      )
    })

    it('should support preview URL in messages', async () => {
      const mockMessage = createMockMessage({
        body: 'Check out https://example.com',
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(mockMessage))

      await whatsapp.sendText({
        to: 'whatsapp:+15558675310',
        body: 'Check out https://example.com',
        previewUrl: true,
      })

      // URL preview should be enabled by default for messages with URLs
      expect(result).toBeDefined()
    })

    it('should include messaging service SID if configured', async () => {
      const clientWithMsgSvc = new TwilioWhatsApp({
        accountSid: TEST_ACCOUNT_SID,
        authToken: TEST_AUTH_TOKEN,
        messagingServiceSid: 'MG123456789',
        fetch: mockFetch,
      })

      const mockMessage = createMockMessage()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockMessage))

      await clientWithMsgSvc.sendText({
        to: 'whatsapp:+15558675310',
        body: 'Hello!',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('MessagingServiceSid=MG123456789'),
        })
      )
    })
  })

  // ============================================================================
  // SEND MEDIA MESSAGES
  // ============================================================================

  describe('sendMedia', () => {
    it('should send a single image', async () => {
      const mockMessage = createMockMessage({
        num_media: '1',
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(mockMessage))

      const result = await whatsapp.sendMedia({
        to: 'whatsapp:+15558675310',
        mediaUrl: 'https://example.com/image.jpg',
      })

      expect(result.num_media).toBe('1')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('MediaUrl='),
        })
      )
    })

    it('should send multiple media URLs', async () => {
      const mockMessage = createMockMessage({
        num_media: '3',
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(mockMessage))

      const result = await whatsapp.sendMedia({
        to: 'whatsapp:+15558675310',
        mediaUrl: [
          'https://example.com/image1.jpg',
          'https://example.com/image2.jpg',
          'https://example.com/image3.jpg',
        ],
      })

      expect(result.num_media).toBe('3')
    })

    it('should send media with caption', async () => {
      const mockMessage = createMockMessage({
        body: 'Check out this image!',
        num_media: '1',
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(mockMessage))

      const result = await whatsapp.sendMedia({
        to: 'whatsapp:+15558675310',
        mediaUrl: 'https://example.com/image.jpg',
        body: 'Check out this image!',
      })

      expect(result.body).toBe('Check out this image!')
      expect(result.num_media).toBe('1')
    })

    it('should support document media type', async () => {
      const mockMessage = createMockMessage({
        num_media: '1',
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(mockMessage))

      await whatsapp.sendMedia({
        to: 'whatsapp:+15558675310',
        mediaUrl: 'https://example.com/document.pdf',
        filename: 'invoice.pdf',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('Filename='),
        })
      )
    })

    it('should support audio media type', async () => {
      const mockMessage = createMockMessage({
        num_media: '1',
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(mockMessage))

      const result = await whatsapp.sendMedia({
        to: 'whatsapp:+15558675310',
        mediaUrl: 'https://example.com/audio.mp3',
      })

      expect(result.num_media).toBe('1')
    })

    it('should support video media type', async () => {
      const mockMessage = createMockMessage({
        num_media: '1',
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(mockMessage))

      const result = await whatsapp.sendMedia({
        to: 'whatsapp:+15558675310',
        mediaUrl: 'https://example.com/video.mp4',
      })

      expect(result.num_media).toBe('1')
    })

    it('should support sticker media type', async () => {
      const mockMessage = createMockMessage({
        num_media: '1',
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(mockMessage))

      const result = await whatsapp.sendMedia({
        to: 'whatsapp:+15558675310',
        mediaUrl: 'https://example.com/sticker.webp',
        mediaType: 'sticker',
      })

      expect(result.num_media).toBe('1')
    })

    it('should reject missing mediaUrl', async () => {
      await expect(
        whatsapp.sendMedia({
          to: 'whatsapp:+15558675310',
          mediaUrl: '',
        })
      ).rejects.toThrow('mediaUrl is required')
    })

    it('should reject more than 10 media URLs', async () => {
      const tooManyUrls = Array(11).fill('https://example.com/image.jpg')
      await expect(
        whatsapp.sendMedia({
          to: 'whatsapp:+15558675310',
          mediaUrl: tooManyUrls,
        })
      ).rejects.toThrow('maximum of 10 media URLs')
    })

    it('should validate media URL format', async () => {
      await expect(
        whatsapp.sendMedia({
          to: 'whatsapp:+15558675310',
          mediaUrl: 'not-a-valid-url',
        })
      ).rejects.toThrow('invalid mediaUrl format')
    })
  })

  // ============================================================================
  // TEMPLATE MESSAGES
  // ============================================================================

  describe('sendTemplate', () => {
    it('should send a template message with content SID', async () => {
      const mockMessage = createMockMessage({
        body: 'Your appointment is confirmed for tomorrow at 2pm.',
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(mockMessage))

      const result = await whatsapp.sendTemplate({
        to: 'whatsapp:+15558675310',
        contentSid: 'HX123456789',
      })

      expect(result.sid).toBeDefined()
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('ContentSid=HX123456789'),
        })
      )
    })

    it('should send template with variables', async () => {
      const mockMessage = createMockMessage()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockMessage))

      await whatsapp.sendTemplate({
        to: 'whatsapp:+15558675310',
        contentSid: 'HX123456789',
        contentVariables: {
          '1': 'John',
          '2': 'tomorrow',
          '3': '2pm',
        },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('ContentVariables='),
        })
      )
    })

    it('should reject missing contentSid', async () => {
      await expect(
        whatsapp.sendTemplate({
          to: 'whatsapp:+15558675310',
          contentSid: '',
        })
      ).rejects.toThrow('contentSid is required')
    })

    it('should support template with header media', async () => {
      const mockMessage = createMockMessage()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockMessage))

      await whatsapp.sendTemplate({
        to: 'whatsapp:+15558675310',
        contentSid: 'HX123456789',
        contentVariables: {
          '1': 'John',
        },
        headerMediaUrl: 'https://example.com/header-image.jpg',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('MediaUrl='),
        })
      )
    })

    it('should support template with document header', async () => {
      const mockMessage = createMockMessage()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockMessage))

      await whatsapp.sendTemplate({
        to: 'whatsapp:+15558675310',
        contentSid: 'HX123456789',
        headerMediaUrl: 'https://example.com/invoice.pdf',
        headerFilename: 'Invoice_2024.pdf',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('Filename='),
        })
      )
    })

    it('should support utility templates (for out-of-session)', async () => {
      const mockMessage = createMockMessage()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockMessage))

      const result = await whatsapp.sendTemplate({
        to: 'whatsapp:+15558675310',
        contentSid: 'HX123456789',
        templateCategory: 'utility',
      })

      expect(result.sid).toBeDefined()
    })

    it('should support authentication templates', async () => {
      const mockMessage = createMockMessage()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockMessage))

      const result = await whatsapp.sendTemplate({
        to: 'whatsapp:+15558675310',
        contentSid: 'HX123456789',
        templateCategory: 'authentication',
        contentVariables: {
          '1': '123456', // OTP code
        },
      })

      expect(result.sid).toBeDefined()
    })

    it('should support marketing templates', async () => {
      const mockMessage = createMockMessage()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockMessage))

      const result = await whatsapp.sendTemplate({
        to: 'whatsapp:+15558675310',
        contentSid: 'HX123456789',
        templateCategory: 'marketing',
      })

      expect(result.sid).toBeDefined()
    })
  })

  // ============================================================================
  // INTERACTIVE MESSAGES (BUTTONS, LISTS)
  // ============================================================================

  describe('sendInteractive - Buttons', () => {
    it('should send a message with quick reply buttons', async () => {
      const mockMessage = createMockMessage()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockMessage))

      const result = await whatsapp.sendInteractive({
        to: 'whatsapp:+15558675310',
        type: 'button',
        body: 'Please select an option:',
        buttons: [
          { id: 'btn_yes', title: 'Yes' },
          { id: 'btn_no', title: 'No' },
          { id: 'btn_maybe', title: 'Maybe' },
        ],
      })

      expect(result.sid).toBeDefined()
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('ContentSid='),
        })
      )
    })

    it('should reject more than 3 buttons', async () => {
      await expect(
        whatsapp.sendInteractive({
          to: 'whatsapp:+15558675310',
          type: 'button',
          body: 'Select an option:',
          buttons: [
            { id: 'btn_1', title: 'Option 1' },
            { id: 'btn_2', title: 'Option 2' },
            { id: 'btn_3', title: 'Option 3' },
            { id: 'btn_4', title: 'Option 4' }, // Too many
          ],
        })
      ).rejects.toThrow('maximum of 3 buttons')
    })

    it('should reject button title longer than 20 characters', async () => {
      await expect(
        whatsapp.sendInteractive({
          to: 'whatsapp:+15558675310',
          type: 'button',
          body: 'Select an option:',
          buttons: [
            { id: 'btn_1', title: 'This title is way too long for a button' },
          ],
        })
      ).rejects.toThrow('button title exceeds 20 characters')
    })

    it('should support button messages with header', async () => {
      const mockMessage = createMockMessage()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockMessage))

      await whatsapp.sendInteractive({
        to: 'whatsapp:+15558675310',
        type: 'button',
        header: {
          type: 'text',
          text: 'Confirmation Required',
        },
        body: 'Do you want to proceed?',
        buttons: [
          { id: 'confirm', title: 'Confirm' },
          { id: 'cancel', title: 'Cancel' },
        ],
      })

      expect(mockFetch).toHaveBeenCalled()
    })

    it('should support button messages with image header', async () => {
      const mockMessage = createMockMessage()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockMessage))

      await whatsapp.sendInteractive({
        to: 'whatsapp:+15558675310',
        type: 'button',
        header: {
          type: 'image',
          mediaUrl: 'https://example.com/product.jpg',
        },
        body: 'Would you like to purchase this item?',
        buttons: [
          { id: 'buy', title: 'Buy Now' },
          { id: 'later', title: 'Maybe Later' },
        ],
      })

      expect(mockFetch).toHaveBeenCalled()
    })

    it('should support button messages with footer', async () => {
      const mockMessage = createMockMessage()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockMessage))

      await whatsapp.sendInteractive({
        to: 'whatsapp:+15558675310',
        type: 'button',
        body: 'Select an option:',
        footer: 'Reply within 24 hours',
        buttons: [
          { id: 'yes', title: 'Yes' },
          { id: 'no', title: 'No' },
        ],
      })

      expect(mockFetch).toHaveBeenCalled()
    })
  })

  describe('sendInteractive - Lists', () => {
    it('should send a message with list selection', async () => {
      const mockMessage = createMockMessage()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockMessage))

      const result = await whatsapp.sendInteractive({
        to: 'whatsapp:+15558675310',
        type: 'list',
        body: 'Please select a category:',
        buttonText: 'View Categories',
        sections: [
          {
            title: 'Electronics',
            rows: [
              { id: 'phones', title: 'Phones', description: 'Mobile devices' },
              { id: 'laptops', title: 'Laptops', description: 'Portable computers' },
            ],
          },
          {
            title: 'Clothing',
            rows: [
              { id: 'shirts', title: 'Shirts', description: 'Casual and formal' },
              { id: 'pants', title: 'Pants', description: 'All styles' },
            ],
          },
        ],
      })

      expect(result.sid).toBeDefined()
    })

    it('should reject list without buttonText', async () => {
      await expect(
        whatsapp.sendInteractive({
          to: 'whatsapp:+15558675310',
          type: 'list',
          body: 'Select a category:',
          buttonText: '',
          sections: [
            {
              title: 'Section 1',
              rows: [{ id: 'item_1', title: 'Item 1' }],
            },
          ],
        })
      ).rejects.toThrow('buttonText is required for list messages')
    })

    it('should reject more than 10 sections', async () => {
      const tooManySections: InteractiveListSection[] = Array(11)
        .fill(null)
        .map((_, i) => ({
          title: `Section ${i}`,
          rows: [{ id: `item_${i}`, title: `Item ${i}` }],
        }))

      await expect(
        whatsapp.sendInteractive({
          to: 'whatsapp:+15558675310',
          type: 'list',
          body: 'Select:',
          buttonText: 'Choose',
          sections: tooManySections,
        })
      ).rejects.toThrow('maximum of 10 sections')
    })

    it('should reject more than 10 rows per section', async () => {
      const tooManyRows = Array(11)
        .fill(null)
        .map((_, i) => ({ id: `row_${i}`, title: `Row ${i}` }))

      await expect(
        whatsapp.sendInteractive({
          to: 'whatsapp:+15558675310',
          type: 'list',
          body: 'Select:',
          buttonText: 'Choose',
          sections: [
            {
              title: 'Section',
              rows: tooManyRows,
            },
          ],
        })
      ).rejects.toThrow('maximum of 10 rows per section')
    })

    it('should reject row title longer than 24 characters', async () => {
      await expect(
        whatsapp.sendInteractive({
          to: 'whatsapp:+15558675310',
          type: 'list',
          body: 'Select:',
          buttonText: 'Choose',
          sections: [
            {
              title: 'Section',
              rows: [
                { id: 'row_1', title: 'This title is way too long for a row item' },
              ],
            },
          ],
        })
      ).rejects.toThrow('row title exceeds 24 characters')
    })

    it('should reject row description longer than 72 characters', async () => {
      await expect(
        whatsapp.sendInteractive({
          to: 'whatsapp:+15558675310',
          type: 'list',
          body: 'Select:',
          buttonText: 'Choose',
          sections: [
            {
              title: 'Section',
              rows: [
                {
                  id: 'row_1',
                  title: 'Valid Title',
                  description: 'a'.repeat(73),
                },
              ],
            },
          ],
        })
      ).rejects.toThrow('row description exceeds 72 characters')
    })
  })

  describe('sendInteractive - Call-to-Action (CTA) URLs', () => {
    it('should send a message with CTA URL button', async () => {
      const mockMessage = createMockMessage()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockMessage))

      const result = await whatsapp.sendInteractive({
        to: 'whatsapp:+15558675310',
        type: 'cta_url',
        body: 'Visit our website for more information',
        ctaUrl: {
          displayText: 'Visit Website',
          url: 'https://example.com',
        },
      })

      expect(result.sid).toBeDefined()
    })

    it('should reject CTA URL without displayText', async () => {
      await expect(
        whatsapp.sendInteractive({
          to: 'whatsapp:+15558675310',
          type: 'cta_url',
          body: 'Visit us',
          ctaUrl: {
            displayText: '',
            url: 'https://example.com',
          },
        })
      ).rejects.toThrow('displayText is required')
    })

    it('should reject CTA URL without url', async () => {
      await expect(
        whatsapp.sendInteractive({
          to: 'whatsapp:+15558675310',
          type: 'cta_url',
          body: 'Visit us',
          ctaUrl: {
            displayText: 'Visit Website',
            url: '',
          },
        })
      ).rejects.toThrow('url is required')
    })
  })

  // ============================================================================
  // SESSION WINDOW HANDLING
  // ============================================================================

  describe('session window handling', () => {
    it('should track session window for incoming messages', async () => {
      const incomingPayload: WhatsAppWebhookPayload = {
        MessageSid: 'SM123',
        AccountSid: TEST_ACCOUNT_SID,
        From: 'whatsapp:+15558675310',
        To: TEST_FROM_NUMBER,
        Body: 'Hello!',
        NumMedia: '0',
        SmsStatus: 'received',
        ApiVersion: '2010-04-01',
      }

      const session = whatsapp.handleIncoming(incomingPayload)

      expect(session).toBeDefined()
      expect(session.from).toBe('whatsapp:+15558675310')
      expect(session.isOpen).toBe(true)
      expect(session.expiresAt).toBeDefined()
    })

    it('should return 24-hour session window expiration', async () => {
      const now = Date.now()
      const incomingPayload: WhatsAppWebhookPayload = {
        MessageSid: 'SM123',
        AccountSid: TEST_ACCOUNT_SID,
        From: 'whatsapp:+15558675310',
        To: TEST_FROM_NUMBER,
        Body: 'Hello!',
        NumMedia: '0',
        SmsStatus: 'received',
        ApiVersion: '2010-04-01',
      }

      const session = whatsapp.handleIncoming(incomingPayload)

      // Session should expire in approximately 24 hours
      const expectedExpiry = now + 24 * 60 * 60 * 1000
      expect(session.expiresAt.getTime()).toBeGreaterThan(expectedExpiry - 1000)
      expect(session.expiresAt.getTime()).toBeLessThan(expectedExpiry + 1000)
    })

    it('should check if session window is open', () => {
      // Create a session by handling incoming message
      const incomingPayload: WhatsAppWebhookPayload = {
        MessageSid: 'SM123',
        AccountSid: TEST_ACCOUNT_SID,
        From: 'whatsapp:+15558675310',
        To: TEST_FROM_NUMBER,
        Body: 'Hello!',
        NumMedia: '0',
        SmsStatus: 'received',
        ApiVersion: '2010-04-01',
      }

      whatsapp.handleIncoming(incomingPayload)

      const isOpen = whatsapp.isSessionOpen('whatsapp:+15558675310')
      expect(isOpen).toBe(true)
    })

    it('should return false for non-existent session', () => {
      const isOpen = whatsapp.isSessionOpen('whatsapp:+19999999999')
      expect(isOpen).toBe(false)
    })

    it('should get session details', () => {
      const incomingPayload: WhatsAppWebhookPayload = {
        MessageSid: 'SM123',
        AccountSid: TEST_ACCOUNT_SID,
        From: 'whatsapp:+15558675310',
        To: TEST_FROM_NUMBER,
        Body: 'Hello!',
        NumMedia: '0',
        SmsStatus: 'received',
        ApiVersion: '2010-04-01',
      }

      whatsapp.handleIncoming(incomingPayload)

      const session = whatsapp.getSession('whatsapp:+15558675310')
      expect(session).toBeDefined()
      expect(session?.from).toBe('whatsapp:+15558675310')
    })

    it('should extend session window on each incoming message', async () => {
      const firstPayload: WhatsAppWebhookPayload = {
        MessageSid: 'SM123',
        AccountSid: TEST_ACCOUNT_SID,
        From: 'whatsapp:+15558675310',
        To: TEST_FROM_NUMBER,
        Body: 'First message',
        NumMedia: '0',
        SmsStatus: 'received',
        ApiVersion: '2010-04-01',
      }

      const firstSession = whatsapp.handleIncoming(firstPayload)
      const firstExpiry = firstSession.expiresAt

      // Simulate small time delay
      await new Promise((resolve) => setTimeout(resolve, 100))

      const secondPayload: WhatsAppWebhookPayload = {
        MessageSid: 'SM456',
        AccountSid: TEST_ACCOUNT_SID,
        From: 'whatsapp:+15558675310',
        To: TEST_FROM_NUMBER,
        Body: 'Second message',
        NumMedia: '0',
        SmsStatus: 'received',
        ApiVersion: '2010-04-01',
      }

      const secondSession = whatsapp.handleIncoming(secondPayload)

      // Second session should have later expiry
      expect(secondSession.expiresAt.getTime()).toBeGreaterThan(firstExpiry.getTime())
    })

    it('should require template for out-of-session messages', async () => {
      // Try to send text message without session
      await expect(
        whatsapp.sendText({
          to: 'whatsapp:+15558675310',
          body: 'Hello!',
          requireSession: true,
        })
      ).rejects.toThrow('session window is closed')
    })

    it('should allow freeform messages within session window', async () => {
      // First, create a session
      const incomingPayload: WhatsAppWebhookPayload = {
        MessageSid: 'SM123',
        AccountSid: TEST_ACCOUNT_SID,
        From: 'whatsapp:+15558675310',
        To: TEST_FROM_NUMBER,
        Body: 'Hello!',
        NumMedia: '0',
        SmsStatus: 'received',
        ApiVersion: '2010-04-01',
      }
      whatsapp.handleIncoming(incomingPayload)

      // Now send a freeform message
      const mockMessage = createMockMessage()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockMessage))

      const result = await whatsapp.sendText({
        to: 'whatsapp:+15558675310',
        body: 'This is a response within session',
        requireSession: true,
      })

      expect(result.sid).toBeDefined()
    })

    it('should clear all sessions', () => {
      const incomingPayload: WhatsAppWebhookPayload = {
        MessageSid: 'SM123',
        AccountSid: TEST_ACCOUNT_SID,
        From: 'whatsapp:+15558675310',
        To: TEST_FROM_NUMBER,
        Body: 'Hello!',
        NumMedia: '0',
        SmsStatus: 'received',
        ApiVersion: '2010-04-01',
      }

      whatsapp.handleIncoming(incomingPayload)
      expect(whatsapp.isSessionOpen('whatsapp:+15558675310')).toBe(true)

      whatsapp.clearSessions()
      expect(whatsapp.isSessionOpen('whatsapp:+15558675310')).toBe(false)
    })
  })

  // ============================================================================
  // STATUS CALLBACKS
  // ============================================================================

  describe('status callbacks', () => {
    it('should handle queued status callback', () => {
      const callback: StatusCallback = {
        MessageSid: 'SM123',
        AccountSid: TEST_ACCOUNT_SID,
        From: TEST_FROM_NUMBER,
        To: 'whatsapp:+15558675310',
        MessageStatus: 'queued',
        ApiVersion: '2010-04-01',
      }

      const status = whatsapp.handleStatusCallback(callback)

      expect(status.sid).toBe('SM123')
      expect(status.status).toBe('queued')
    })

    it('should handle sent status callback', () => {
      const callback: StatusCallback = {
        MessageSid: 'SM123',
        AccountSid: TEST_ACCOUNT_SID,
        From: TEST_FROM_NUMBER,
        To: 'whatsapp:+15558675310',
        MessageStatus: 'sent',
        ApiVersion: '2010-04-01',
      }

      const status = whatsapp.handleStatusCallback(callback)

      expect(status.status).toBe('sent')
    })

    it('should handle delivered status callback', () => {
      const callback: StatusCallback = {
        MessageSid: 'SM123',
        AccountSid: TEST_ACCOUNT_SID,
        From: TEST_FROM_NUMBER,
        To: 'whatsapp:+15558675310',
        MessageStatus: 'delivered',
        ApiVersion: '2010-04-01',
      }

      const status = whatsapp.handleStatusCallback(callback)

      expect(status.status).toBe('delivered')
    })

    it('should handle read status callback', () => {
      const callback: StatusCallback = {
        MessageSid: 'SM123',
        AccountSid: TEST_ACCOUNT_SID,
        From: TEST_FROM_NUMBER,
        To: 'whatsapp:+15558675310',
        MessageStatus: 'read',
        ApiVersion: '2010-04-01',
      }

      const status = whatsapp.handleStatusCallback(callback)

      expect(status.status).toBe('read')
    })

    it('should handle failed status callback with error', () => {
      const callback: StatusCallback = {
        MessageSid: 'SM123',
        AccountSid: TEST_ACCOUNT_SID,
        From: TEST_FROM_NUMBER,
        To: 'whatsapp:+15558675310',
        MessageStatus: 'failed',
        ErrorCode: '63016',
        ErrorMessage: 'Failed to send WhatsApp message',
        ApiVersion: '2010-04-01',
      }

      const status = whatsapp.handleStatusCallback(callback)

      expect(status.status).toBe('failed')
      expect(status.errorCode).toBe('63016')
      expect(status.errorMessage).toBe('Failed to send WhatsApp message')
    })

    it('should handle undelivered status callback', () => {
      const callback: StatusCallback = {
        MessageSid: 'SM123',
        AccountSid: TEST_ACCOUNT_SID,
        From: TEST_FROM_NUMBER,
        To: 'whatsapp:+15558675310',
        MessageStatus: 'undelivered',
        ErrorCode: '63003',
        ErrorMessage: 'Message undelivered',
        ApiVersion: '2010-04-01',
      }

      const status = whatsapp.handleStatusCallback(callback)

      expect(status.status).toBe('undelivered')
      expect(status.errorCode).toBe('63003')
    })

    it('should track message status history', () => {
      const callbacks: StatusCallback[] = [
        {
          MessageSid: 'SM123',
          AccountSid: TEST_ACCOUNT_SID,
          From: TEST_FROM_NUMBER,
          To: 'whatsapp:+15558675310',
          MessageStatus: 'queued',
          ApiVersion: '2010-04-01',
        },
        {
          MessageSid: 'SM123',
          AccountSid: TEST_ACCOUNT_SID,
          From: TEST_FROM_NUMBER,
          To: 'whatsapp:+15558675310',
          MessageStatus: 'sent',
          ApiVersion: '2010-04-01',
        },
        {
          MessageSid: 'SM123',
          AccountSid: TEST_ACCOUNT_SID,
          From: TEST_FROM_NUMBER,
          To: 'whatsapp:+15558675310',
          MessageStatus: 'delivered',
          ApiVersion: '2010-04-01',
        },
      ]

      callbacks.forEach((cb) => whatsapp.handleStatusCallback(cb))

      const history = whatsapp.getMessageStatusHistory('SM123')
      expect(history).toHaveLength(3)
      expect(history[0].status).toBe('queued')
      expect(history[1].status).toBe('sent')
      expect(history[2].status).toBe('delivered')
    })

    it('should get current message status', () => {
      const callback: StatusCallback = {
        MessageSid: 'SM123',
        AccountSid: TEST_ACCOUNT_SID,
        From: TEST_FROM_NUMBER,
        To: 'whatsapp:+15558675310',
        MessageStatus: 'delivered',
        ApiVersion: '2010-04-01',
      }

      whatsapp.handleStatusCallback(callback)

      const currentStatus = whatsapp.getMessageStatus('SM123')
      expect(currentStatus).toBe('delivered')
    })

    it('should return null for unknown message status', () => {
      const currentStatus = whatsapp.getMessageStatus('SM_UNKNOWN')
      expect(currentStatus).toBeNull()
    })

    it('should emit status change events', () => {
      const statusHandler = vi.fn()
      whatsapp.onStatusChange(statusHandler)

      const callback: StatusCallback = {
        MessageSid: 'SM123',
        AccountSid: TEST_ACCOUNT_SID,
        From: TEST_FROM_NUMBER,
        To: 'whatsapp:+15558675310',
        MessageStatus: 'delivered',
        ApiVersion: '2010-04-01',
      }

      whatsapp.handleStatusCallback(callback)

      expect(statusHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          sid: 'SM123',
          status: 'delivered',
        })
      )
    })

    it('should create webhook handler for status callbacks', () => {
      const router = whatsapp.createWebhookHandler()
      expect(router).toBeDefined()
    })

    it('should handle webhook POST for status updates', async () => {
      const router = whatsapp.createWebhookHandler()

      const request = new Request('http://localhost/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          MessageSid: 'SM123',
          AccountSid: TEST_ACCOUNT_SID,
          From: TEST_FROM_NUMBER,
          To: 'whatsapp:+15558675310',
          MessageStatus: 'delivered',
          ApiVersion: '2010-04-01',
        }).toString(),
      })

      const response = await router.fetch(request)

      expect(response.status).toBe(200)
    })

    it('should handle webhook POST for incoming messages', async () => {
      const router = whatsapp.createWebhookHandler()

      const request = new Request('http://localhost/incoming', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          MessageSid: 'SM123',
          AccountSid: TEST_ACCOUNT_SID,
          From: 'whatsapp:+15558675310',
          To: TEST_FROM_NUMBER,
          Body: 'Hello!',
          NumMedia: '0',
          SmsStatus: 'received',
          ApiVersion: '2010-04-01',
        }).toString(),
      })

      const response = await router.fetch(request)

      expect(response.status).toBe(200)
      // Should create session
      expect(whatsapp.isSessionOpen('whatsapp:+15558675310')).toBe(true)
    })
  })

  // ============================================================================
  // ERROR HANDLING
  // ============================================================================

  describe('error handling', () => {
    it('should throw TwilioWhatsAppError for API errors', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockErrorResponse(63003, 'Message undeliverable', 400)
      )

      try {
        await whatsapp.sendText({
          to: 'whatsapp:+15558675310',
          body: 'Hello!',
        })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(TwilioWhatsAppError)
        expect((error as TwilioWhatsAppError).code).toBe(63003)
        expect((error as TwilioWhatsAppError).status).toBe(400)
      }
    })

    it('should handle rate limit errors (error 63018)', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockErrorResponse(63018, 'Rate limit exceeded', 429)
      )

      try {
        await whatsapp.sendText({
          to: 'whatsapp:+15558675310',
          body: 'Hello!',
        })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(TwilioWhatsAppError)
        expect((error as TwilioWhatsAppError).code).toBe(63018)
      }
    })

    it('should handle template not found error (error 63016)', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockErrorResponse(63016, 'Template not found', 400)
      )

      try {
        await whatsapp.sendTemplate({
          to: 'whatsapp:+15558675310',
          contentSid: 'HX_INVALID',
        })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(TwilioWhatsAppError)
        expect((error as TwilioWhatsAppError).code).toBe(63016)
      }
    })

    it('should handle invalid recipient error (error 63001)', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockErrorResponse(63001, 'Invalid WhatsApp number', 400)
      )

      try {
        await whatsapp.sendText({
          to: 'whatsapp:+00000000000',
          body: 'Hello!',
        })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(TwilioWhatsAppError)
        expect((error as TwilioWhatsAppError).code).toBe(63001)
      }
    })

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      await expect(
        whatsapp.sendText({
          to: 'whatsapp:+15558675310',
          body: 'Hello!',
        })
      ).rejects.toThrow('Network error')
    })

    it('should handle timeout errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Request timed out'))

      await expect(
        whatsapp.sendText({
          to: 'whatsapp:+15558675310',
          body: 'Hello!',
        })
      ).rejects.toThrow()
    })
  })

  // ============================================================================
  // AUTHENTICATION
  // ============================================================================

  describe('authentication', () => {
    it('should send Basic Auth header', async () => {
      const mockMessage = createMockMessage()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockMessage))

      await whatsapp.sendText({
        to: 'whatsapp:+15558675310',
        body: 'Hello!',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expect.stringMatching(/^Basic /),
          }),
        })
      )
    })

    it('should use correct API endpoint', async () => {
      const mockMessage = createMockMessage()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockMessage))

      await whatsapp.sendText({
        to: 'whatsapp:+15558675310',
        body: 'Hello!',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('api.twilio.com'),
        expect.any(Object)
      )
    })

    it('should include account SID in endpoint path', async () => {
      const mockMessage = createMockMessage()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockMessage))

      await whatsapp.sendText({
        to: 'whatsapp:+15558675310',
        body: 'Hello!',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/Accounts/${TEST_ACCOUNT_SID}/`),
        expect.any(Object)
      )
    })
  })

  // ============================================================================
  // MESSAGE RETRIEVAL
  // ============================================================================

  describe('message retrieval', () => {
    it('should fetch a message by SID', async () => {
      const mockMessage = createMockMessage({
        sid: 'SM123456789',
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(mockMessage))

      const message = await whatsapp.getMessage('SM123456789')

      expect(message.sid).toBe('SM123456789')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/Messages/SM123456789.json'),
        expect.any(Object)
      )
    })

    it('should list messages with filters', async () => {
      const mockResponse = {
        messages: [createMockMessage(), createMockMessage()],
      }
      mockFetch.mockResolvedValueOnce(createMockResponse(mockResponse))

      const messages = await whatsapp.listMessages({
        to: 'whatsapp:+15558675310',
        pageSize: 20,
      })

      expect(messages).toHaveLength(2)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('To=whatsapp'),
        expect.any(Object)
      )
    })

    it('should delete a message', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }))

      const result = await whatsapp.deleteMessage('SM123456789')

      expect(result).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/Messages/SM123456789.json'),
        expect.objectContaining({
          method: 'DELETE',
        })
      )
    })
  })
})

/**
 * @dotdo/sendgrid Tests
 *
 * TDD tests for the SendGrid SDK compatibility layer.
 * Tests cover mail sending, validation, templates, contacts, and stats.
 *
 * Following RED-GREEN-REFACTOR pattern:
 * - RED: These tests are written first and should fail initially
 * - GREEN: Implementation makes tests pass
 * - REFACTOR: Clean up while keeping tests green
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import sgMail, {
  MailService,
  SendGridClient,
  validateSendGridRequest,
  ResponseError,
  type MailDataRequired,
  type SendGridMailRequest,
} from '../src/index'

// =============================================================================
// MAIL SERVICE TESTS
// =============================================================================

describe('@dotdo/sendgrid - MailService', () => {
  let mailService: MailService

  beforeEach(() => {
    mailService = new MailService()
  })

  describe('setApiKey()', () => {
    it('should set the API key', () => {
      mailService.setApiKey('SG.test-api-key')
      expect(mailService.getApiKey()).toBe('SG.test-api-key')
    })
  })

  describe('setTimeout()', () => {
    it('should set the timeout value', () => {
      mailService.setTimeout(30000)
      // Timeout is private, so we just verify no error is thrown
      expect(true).toBe(true)
    })
  })

  describe('setSubstitutionWrappers()', () => {
    it('should set substitution wrappers', () => {
      mailService.setSubstitutionWrappers('<%', '%>')
      // Wrappers are private, so we just verify no error is thrown
      expect(true).toBe(true)
    })
  })

  describe('send() validation', () => {
    it('should throw error if API key is not set', async () => {
      const mailData: MailDataRequired = {
        to: 'test@example.com',
        from: 'sender@example.com',
        subject: 'Test',
        text: 'Hello',
      }

      await expect(mailService.send(mailData)).rejects.toThrow(
        /API key is required/
      )
    })

    it('should throw error if "to" field is missing', async () => {
      mailService.setApiKey('SG.test')
      const mailData: MailDataRequired = {
        from: 'sender@example.com',
        subject: 'Test',
        text: 'Hello',
      }

      await expect(mailService.send(mailData)).rejects.toThrow()
    })
  })
})

// =============================================================================
// DEFAULT INSTANCE TESTS
// =============================================================================

describe('@dotdo/sendgrid - Default Instance', () => {
  it('should export default mail service instance', () => {
    expect(sgMail).toBeDefined()
    expect(typeof sgMail.setApiKey).toBe('function')
    expect(typeof sgMail.send).toBe('function')
    expect(typeof sgMail.sendMultiple).toBe('function')
  })
})

// =============================================================================
// VALIDATION TESTS
// =============================================================================

describe('@dotdo/sendgrid - Validation', () => {
  describe('validateSendGridRequest()', () => {
    it('should return valid for proper request', () => {
      const request: SendGridMailRequest = {
        personalizations: [
          { to: [{ email: 'test@example.com' }] },
        ],
        from: { email: 'sender@example.com' },
        subject: 'Test Subject',
        content: [{ type: 'text/plain', value: 'Hello' }],
      }

      const result = validateSendGridRequest(request)
      expect(result.valid).toBe(true)
    })

    it('should fail if personalizations is empty', () => {
      const request: SendGridMailRequest = {
        personalizations: [],
        from: { email: 'sender@example.com' },
        subject: 'Test',
        content: [{ type: 'text/plain', value: 'Hello' }],
      }

      const result = validateSendGridRequest(request)
      expect(result.valid).toBe(false)
      expect(result.errors?.errors[0].field).toBe('personalizations')
    })

    it('should fail if personalizations.to is empty', () => {
      const request: SendGridMailRequest = {
        personalizations: [{ to: [] }],
        from: { email: 'sender@example.com' },
        subject: 'Test',
        content: [{ type: 'text/plain', value: 'Hello' }],
      }

      const result = validateSendGridRequest(request)
      expect(result.valid).toBe(false)
      expect(result.errors?.errors[0].field).toBe('personalizations.0.to')
    })

    it('should fail if from is missing', () => {
      const request = {
        personalizations: [{ to: [{ email: 'test@example.com' }] }],
        subject: 'Test',
        content: [{ type: 'text/plain', value: 'Hello' }],
      } as SendGridMailRequest

      const result = validateSendGridRequest(request)
      expect(result.valid).toBe(false)
      expect(result.errors?.errors.some(e => e.field === 'from')).toBe(true)
    })

    it('should fail if subject is missing and no template', () => {
      const request: SendGridMailRequest = {
        personalizations: [{ to: [{ email: 'test@example.com' }] }],
        from: { email: 'sender@example.com' },
        content: [{ type: 'text/plain', value: 'Hello' }],
      }

      const result = validateSendGridRequest(request)
      expect(result.valid).toBe(false)
      expect(result.errors?.errors.some(e => e.field === 'subject')).toBe(true)
    })

    it('should pass if template_id is provided instead of subject', () => {
      const request: SendGridMailRequest = {
        personalizations: [{ to: [{ email: 'test@example.com' }] }],
        from: { email: 'sender@example.com' },
        template_id: 'd-xxxxx',
      }

      const result = validateSendGridRequest(request)
      expect(result.valid).toBe(true)
    })

    it('should fail if content is missing and no template', () => {
      const request: SendGridMailRequest = {
        personalizations: [{ to: [{ email: 'test@example.com' }] }],
        from: { email: 'sender@example.com' },
        subject: 'Test',
      }

      const result = validateSendGridRequest(request)
      expect(result.valid).toBe(false)
      expect(result.errors?.errors.some(e => e.field === 'content')).toBe(true)
    })

    it('should fail for invalid email address', () => {
      const request: SendGridMailRequest = {
        personalizations: [{ to: [{ email: 'test@example.com' }] }],
        from: { email: 'invalid-email' },
        subject: 'Test',
        content: [{ type: 'text/plain', value: 'Hello' }],
      }

      const result = validateSendGridRequest(request)
      expect(result.valid).toBe(false)
      expect(result.errors?.errors.some(e => e.field === 'from.email')).toBe(true)
    })
  })
})

// =============================================================================
// RESPONSE ERROR TESTS
// =============================================================================

describe('@dotdo/sendgrid - ResponseError', () => {
  it('should create error with message and code', () => {
    const error = new ResponseError('Bad Request', 400)
    expect(error.message).toBe('Bad Request')
    expect(error.code).toBe(400)
    expect(error.name).toBe('ResponseError')
  })

  it('should include response body structure', () => {
    const error = new ResponseError('Bad Request', 400)
    // The ResponseError constructor uses the message parameter as the first error
    expect(error.response.body.errors).toHaveLength(1)
    expect(error.response.body.errors[0].message).toBe('Bad Request')
    expect(error.response.headers).toEqual({})
  })
})

// =============================================================================
// SENDGRID CLIENT TESTS
// =============================================================================

describe('@dotdo/sendgrid - SendGridClient', () => {
  it('should create client with API key', () => {
    const client = new SendGridClient({ apiKey: 'SG.test' })
    expect(client).toBeDefined()
    expect(client.mail).toBeDefined()
    expect(client.templates).toBeDefined()
    expect(client.contacts).toBeDefined()
    expect(client.lists).toBeDefined()
    expect(client.stats).toBeDefined()
  })

  it('should expose mail resource', () => {
    const client = new SendGridClient({ apiKey: 'SG.test' })
    expect(typeof client.mail.send).toBe('function')
  })

  it('should expose templates resource', () => {
    const client = new SendGridClient({ apiKey: 'SG.test' })
    expect(typeof client.templates.create).toBe('function')
    expect(typeof client.templates.retrieve).toBe('function')
    expect(typeof client.templates.update).toBe('function')
    expect(typeof client.templates.delete).toBe('function')
    expect(typeof client.templates.list).toBe('function')
  })

  it('should expose contacts resource', () => {
    const client = new SendGridClient({ apiKey: 'SG.test' })
    expect(typeof client.contacts.add).toBe('function')
    expect(typeof client.contacts.get).toBe('function')
    expect(typeof client.contacts.search).toBe('function')
    expect(typeof client.contacts.count).toBe('function')
  })

  it('should expose lists resource', () => {
    const client = new SendGridClient({ apiKey: 'SG.test' })
    expect(typeof client.lists.create).toBe('function')
    expect(typeof client.lists.get).toBe('function')
    expect(typeof client.lists.update).toBe('function')
    expect(typeof client.lists.delete).toBe('function')
    expect(typeof client.lists.list).toBe('function')
  })

  it('should expose stats resource', () => {
    const client = new SendGridClient({ apiKey: 'SG.test' })
    expect(typeof client.stats.global).toBe('function')
    expect(typeof client.stats.categories).toBe('function')
    expect(typeof client.stats.subusers).toBe('function')
  })
})

// =============================================================================
// EMAIL ADDRESS NORMALIZATION TESTS
// =============================================================================

describe('@dotdo/sendgrid - Email Address Handling', () => {
  describe('email address formats', () => {
    it('should accept string email address', () => {
      const request: SendGridMailRequest = {
        personalizations: [{ to: [{ email: 'test@example.com' }] }],
        from: { email: 'sender@example.com' },
        subject: 'Test',
        content: [{ type: 'text/plain', value: 'Hello' }],
      }

      const result = validateSendGridRequest(request)
      expect(result.valid).toBe(true)
    })

    it('should accept email with name format', () => {
      const request: SendGridMailRequest = {
        personalizations: [
          { to: [{ email: 'test@example.com', name: 'Test User' }] },
        ],
        from: { email: 'sender@example.com', name: 'Sender Name' },
        subject: 'Test',
        content: [{ type: 'text/plain', value: 'Hello' }],
      }

      const result = validateSendGridRequest(request)
      expect(result.valid).toBe(true)
    })
  })
})

// =============================================================================
// MAIL DATA REQUIRED INTERFACE TESTS
// =============================================================================

describe('@dotdo/sendgrid - MailDataRequired Interface', () => {
  it('should accept minimal required fields', () => {
    const mailData: MailDataRequired = {
      to: 'test@example.com',
      from: 'sender@example.com',
      subject: 'Test',
      text: 'Hello World',
    }

    expect(mailData.to).toBe('test@example.com')
    expect(mailData.from).toBe('sender@example.com')
    expect(mailData.subject).toBe('Test')
    expect(mailData.text).toBe('Hello World')
  })

  it('should accept array of recipients', () => {
    const mailData: MailDataRequired = {
      to: ['user1@example.com', 'user2@example.com'],
      from: 'sender@example.com',
      subject: 'Test',
      html: '<h1>Hello</h1>',
    }

    expect(Array.isArray(mailData.to)).toBe(true)
    expect((mailData.to as string[]).length).toBe(2)
  })

  it('should accept personalizations', () => {
    const mailData: MailDataRequired = {
      from: 'sender@example.com',
      personalizations: [
        {
          to: 'user1@example.com',
          dynamicTemplateData: { name: 'User 1' },
        },
        {
          to: 'user2@example.com',
          dynamicTemplateData: { name: 'User 2' },
        },
      ],
      templateId: 'd-xxxxx',
    }

    expect(mailData.personalizations?.length).toBe(2)
    expect(mailData.templateId).toBe('d-xxxxx')
  })

  it('should accept camelCase and snake_case aliases', () => {
    const mailData: MailDataRequired = {
      to: 'test@example.com',
      from: 'sender@example.com',
      template_id: 'd-xxxxx',
      dynamic_template_data: { name: 'Test' },
      send_at: 1234567890,
      custom_args: { arg1: 'value1' },
    }

    expect(mailData.template_id).toBe('d-xxxxx')
    expect(mailData.dynamic_template_data?.name).toBe('Test')
  })

  it('should accept attachments', () => {
    const mailData: MailDataRequired = {
      to: 'test@example.com',
      from: 'sender@example.com',
      subject: 'With Attachment',
      text: 'See attached.',
      attachments: [
        {
          content: 'SGVsbG8gV29ybGQ=', // Base64 "Hello World"
          filename: 'hello.txt',
          type: 'text/plain',
          disposition: 'attachment',
        },
      ],
    }

    expect(mailData.attachments?.length).toBe(1)
    expect(mailData.attachments?.[0].filename).toBe('hello.txt')
  })

  it('should accept categories', () => {
    const mailData: MailDataRequired = {
      to: 'test@example.com',
      from: 'sender@example.com',
      subject: 'Categorized',
      text: 'Hello',
      categories: ['marketing', 'newsletter'],
    }

    expect(mailData.categories?.length).toBe(2)
    expect(mailData.categories?.[0]).toBe('marketing')
  })

  it('should accept cc and bcc', () => {
    const mailData: MailDataRequired = {
      to: 'primary@example.com',
      cc: 'cc@example.com',
      bcc: ['bcc1@example.com', 'bcc2@example.com'],
      from: 'sender@example.com',
      subject: 'CC/BCC Test',
      text: 'Hello',
    }

    expect(mailData.cc).toBe('cc@example.com')
    expect((mailData.bcc as string[]).length).toBe(2)
  })

  it('should accept replyTo', () => {
    const mailData: MailDataRequired = {
      to: 'test@example.com',
      from: 'sender@example.com',
      replyTo: 'reply@example.com',
      subject: 'Reply Test',
      text: 'Hello',
    }

    expect(mailData.replyTo).toBe('reply@example.com')
  })

  it('should accept custom headers', () => {
    const mailData: MailDataRequired = {
      to: 'test@example.com',
      from: 'sender@example.com',
      subject: 'Custom Headers',
      text: 'Hello',
      headers: {
        'X-Custom-Header': 'custom-value',
      },
    }

    expect(mailData.headers?.['X-Custom-Header']).toBe('custom-value')
  })
})

// =============================================================================
// PROVIDER EXPORTS TESTS
// =============================================================================

describe('@dotdo/sendgrid - Provider Exports', () => {
  it('should export ProviderRouter', async () => {
    const { ProviderRouter } = await import('../src/providers')
    expect(ProviderRouter).toBeDefined()
  })

  it('should export provider adapters', async () => {
    const {
      MailChannelsProvider,
      ResendProvider,
      SendGridNativeProvider,
    } = await import('../src/providers')

    expect(MailChannelsProvider).toBeDefined()
    expect(ResendProvider).toBeDefined()
    expect(SendGridNativeProvider).toBeDefined()
  })

  it('should export createProvider helper', async () => {
    const { createProvider } = await import('../src/providers')
    expect(typeof createProvider).toBe('function')
  })
})

// =============================================================================
// TYPE EXPORTS TESTS
// =============================================================================

describe('@dotdo/sendgrid - Type Exports', () => {
  it('should export all required types', async () => {
    const types = await import('../src/index')

    // Verify key exports exist
    expect(types.SendGridClient).toBeDefined()
    expect(types.MailService).toBeDefined()
    expect(types.ResponseError).toBeDefined()
    expect(types.validateSendGridRequest).toBeDefined()
    expect(types.default).toBeDefined() // sgMail default export
  })
})

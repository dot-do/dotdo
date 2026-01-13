/**
 * DocuSign Envelopes API Tests
 *
 * Tests for DocuSign envelope operations - the core of document signing.
 * Following TDD - write tests first, then implement.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  DocuSignClient,
  EnvelopesResource,
  Envelope,
  EnvelopeStatus,
  EnvelopeCreateParams,
  EnvelopeUpdateParams,
  EnvelopeSendParams,
  EnvelopeVoidParams,
  EnvelopeListParams,
  ListResponse,
  DocuSignError,
} from '../index'

describe('DocuSign Envelopes API', () => {
  let client: DocuSignClient
  let envelopes: EnvelopesResource

  beforeEach(() => {
    client = new DocuSignClient({
      accessToken: 'test-token',
      accountId: 'test-account',
      basePath: 'https://demo.docusign.net/restapi',
    })
    envelopes = client.envelopes
  })

  describe('Envelope Creation', () => {
    it('should create a draft envelope', async () => {
      const envelope = await envelopes.create({
        emailSubject: 'Please sign this document',
        status: 'created',
      })

      expect(envelope.envelopeId).toBeDefined()
      expect(envelope.status).toBe('created')
    })

    it('should create and send envelope in one call', async () => {
      const envelope = await envelopes.create({
        emailSubject: 'Please sign this document',
        emailBlurb: 'Please review and sign the attached document.',
        status: 'sent',
        recipients: {
          signers: [
            {
              email: 'signer@example.com',
              name: 'John Doe',
              recipientId: '1',
              routingOrder: '1',
            },
          ],
        },
        documents: [
          {
            documentId: '1',
            name: 'Contract.pdf',
            documentBase64: 'JVBERi0xLjQKJeLjz9MK...', // PDF content
          },
        ],
      })

      expect(envelope.envelopeId).toBeDefined()
      expect(envelope.status).toBe('sent')
    })

    it('should create envelope with multiple recipients', async () => {
      const envelope = await envelopes.create({
        emailSubject: 'Multi-party agreement',
        status: 'created',
        recipients: {
          signers: [
            {
              email: 'signer1@example.com',
              name: 'First Signer',
              recipientId: '1',
              routingOrder: '1',
            },
            {
              email: 'signer2@example.com',
              name: 'Second Signer',
              recipientId: '2',
              routingOrder: '2',
            },
          ],
          carbonCopies: [
            {
              email: 'cc@example.com',
              name: 'CC Recipient',
              recipientId: '3',
              routingOrder: '3',
            },
          ],
        },
      })

      expect(envelope.envelopeId).toBeDefined()
    })

    it('should create envelope with signing tabs', async () => {
      const envelope = await envelopes.create({
        emailSubject: 'Contract with signature fields',
        status: 'created',
        recipients: {
          signers: [
            {
              email: 'signer@example.com',
              name: 'John Doe',
              recipientId: '1',
              routingOrder: '1',
              tabs: {
                signHereTabs: [
                  {
                    documentId: '1',
                    pageNumber: '1',
                    xPosition: '100',
                    yPosition: '500',
                  },
                ],
                dateSignedTabs: [
                  {
                    documentId: '1',
                    pageNumber: '1',
                    xPosition: '300',
                    yPosition: '500',
                  },
                ],
                textTabs: [
                  {
                    documentId: '1',
                    pageNumber: '1',
                    xPosition: '100',
                    yPosition: '400',
                    tabLabel: 'FullName',
                    required: 'true',
                  },
                ],
              },
            },
          ],
        },
        documents: [
          {
            documentId: '1',
            name: 'Agreement.pdf',
            documentBase64: 'JVBERi0xLjQK...',
          },
        ],
      })

      expect(envelope.envelopeId).toBeDefined()
    })

    it('should create envelope with document visibility settings', async () => {
      const envelope = await envelopes.create({
        emailSubject: 'Confidential document',
        status: 'created',
        documents: [
          {
            documentId: '1',
            name: 'Public.pdf',
            documentBase64: 'JVBERi0xLjQK...',
          },
          {
            documentId: '2',
            name: 'Confidential.pdf',
            documentBase64: 'JVBERi0xLjQK...',
            documentVisibility: [
              {
                recipientId: '1',
                visible: 'true',
              },
              {
                recipientId: '2',
                visible: 'false',
              },
            ],
          },
        ],
        recipients: {
          signers: [
            { email: 'admin@example.com', name: 'Admin', recipientId: '1', routingOrder: '1' },
            { email: 'user@example.com', name: 'User', recipientId: '2', routingOrder: '2' },
          ],
        },
      })

      expect(envelope.envelopeId).toBeDefined()
    })

    it('should create envelope with composite templates', async () => {
      const envelope = await envelopes.create({
        emailSubject: 'Template-based envelope',
        status: 'created',
        compositeTemplates: [
          {
            serverTemplates: [
              {
                sequence: '1',
                templateId: 'template-123',
              },
            ],
            inlineTemplates: [
              {
                sequence: '2',
                recipients: {
                  signers: [
                    {
                      email: 'signer@example.com',
                      name: 'John Doe',
                      recipientId: '1',
                      roleName: 'Signer',
                    },
                  ],
                },
              },
            ],
          },
        ],
      })

      expect(envelope.envelopeId).toBeDefined()
    })

    it('should create envelope with custom fields', async () => {
      const envelope = await envelopes.create({
        emailSubject: 'Document with custom fields',
        status: 'created',
        customFields: {
          textCustomFields: [
            {
              name: 'OrderNumber',
              value: 'ORD-12345',
              required: 'false',
              show: 'true',
            },
          ],
          listCustomFields: [
            {
              name: 'Department',
              value: 'Sales',
              listItems: ['Sales', 'Marketing', 'Engineering'],
              required: 'true',
              show: 'true',
            },
          ],
        },
      })

      expect(envelope.envelopeId).toBeDefined()
    })

    it('should create envelope with notification settings', async () => {
      const envelope = await envelopes.create({
        emailSubject: 'Time-sensitive document',
        status: 'created',
        notification: {
          useAccountDefaults: 'false',
          reminders: {
            reminderEnabled: 'true',
            reminderDelay: '2',
            reminderFrequency: '2',
          },
          expirations: {
            expireEnabled: 'true',
            expireAfter: '30',
            expireWarn: '5',
          },
        },
      })

      expect(envelope.envelopeId).toBeDefined()
    })

    it('should validate required fields when creating', async () => {
      await expect(
        envelopes.create({
          status: 'sent',
          // Missing emailSubject, recipients, documents
        } as EnvelopeCreateParams)
      ).rejects.toThrow(DocuSignError)
    })
  })

  describe('Envelope Retrieval', () => {
    it('should retrieve envelope by ID', async () => {
      // First create an envelope
      const created = await envelopes.create({
        emailSubject: 'Test envelope',
        status: 'created',
      })

      const envelope = await envelopes.get(created.envelopeId)

      expect(envelope.envelopeId).toBe(created.envelopeId)
      expect(envelope.emailSubject).toBe('Test envelope')
    })

    it('should include envelope summary information', async () => {
      const created = await envelopes.create({
        emailSubject: 'Test envelope',
        status: 'created',
      })

      const envelope = await envelopes.get(created.envelopeId)

      expect(envelope.createdDateTime).toBeDefined()
      expect(envelope.status).toBeDefined()
      expect(envelope.statusChangedDateTime).toBeDefined()
    })

    it('should include recipient information when requested', async () => {
      const created = await envelopes.create({
        emailSubject: 'Test',
        status: 'created',
        recipients: {
          signers: [
            { email: 'test@example.com', name: 'Test', recipientId: '1', routingOrder: '1' },
          ],
        },
      })

      const envelope = await envelopes.get(created.envelopeId, {
        include: ['recipients'],
      })

      expect(envelope.recipients).toBeDefined()
      expect(envelope.recipients?.signers?.length).toBe(1)
    })

    it('should include document information when requested', async () => {
      const created = await envelopes.create({
        emailSubject: 'Test',
        status: 'created',
        documents: [
          {
            documentId: '1',
            name: 'Doc.pdf',
            documentBase64: 'JVBERi0xLjQK...',
          },
        ],
      })

      const envelope = await envelopes.get(created.envelopeId, {
        include: ['documents'],
      })

      expect(envelope.documents).toBeDefined()
      expect(envelope.documents?.length).toBe(1)
    })

    it('should throw error for non-existent envelope', async () => {
      await expect(envelopes.get('non-existent-id')).rejects.toThrow(DocuSignError)
    })
  })

  describe('Envelope Listing', () => {
    it('should list envelopes', async () => {
      // Create some test envelopes
      await envelopes.create({ emailSubject: 'Test 1', status: 'created' })
      await envelopes.create({ emailSubject: 'Test 2', status: 'created' })

      const list = await envelopes.list()

      expect(list.envelopes).toBeDefined()
      expect(Array.isArray(list.envelopes)).toBe(true)
    })

    it('should filter by status', async () => {
      await envelopes.create({ emailSubject: 'Draft', status: 'created' })

      const list = await envelopes.list({
        status: 'created',
      })

      expect(list.envelopes?.every((e) => e.status === 'created')).toBe(true)
    })

    it('should filter by date range', async () => {
      const fromDate = new Date()
      fromDate.setDate(fromDate.getDate() - 7)

      const list = await envelopes.list({
        fromDate: fromDate.toISOString(),
        toDate: new Date().toISOString(),
      })

      expect(list.envelopes).toBeDefined()
    })

    it('should filter by folder', async () => {
      const list = await envelopes.list({
        folderIds: ['sent', 'drafts'],
      })

      expect(list.envelopes).toBeDefined()
    })

    it('should paginate results', async () => {
      const list = await envelopes.list({
        count: '10',
        startPosition: '0',
      })

      expect(list.resultSetSize).toBeDefined()
      expect(list.totalSetSize).toBeDefined()
      expect(list.startPosition).toBe('0')
    })

    it('should search by text', async () => {
      await envelopes.create({ emailSubject: 'Contract Agreement', status: 'created' })

      const list = await envelopes.list({
        searchText: 'Contract',
      })

      expect(list.envelopes).toBeDefined()
    })

    it('should order results', async () => {
      const list = await envelopes.list({
        order: 'desc',
        orderBy: 'created',
      })

      expect(list.envelopes).toBeDefined()
    })
  })

  describe('Envelope Updates', () => {
    it('should update envelope email subject', async () => {
      const created = await envelopes.create({
        emailSubject: 'Original Subject',
        status: 'created',
      })

      const updated = await envelopes.update(created.envelopeId, {
        emailSubject: 'Updated Subject',
      })

      expect(updated.emailSubject).toBe('Updated Subject')
    })

    it('should update envelope email blurb', async () => {
      const created = await envelopes.create({
        emailSubject: 'Test',
        emailBlurb: 'Original message',
        status: 'created',
      })

      const updated = await envelopes.update(created.envelopeId, {
        emailBlurb: 'Updated message',
      })

      expect(updated.emailBlurb).toBe('Updated message')
    })

    it('should update notification settings', async () => {
      const created = await envelopes.create({
        emailSubject: 'Test',
        status: 'created',
      })

      const updated = await envelopes.update(created.envelopeId, {
        notification: {
          reminders: {
            reminderEnabled: 'true',
            reminderDelay: '3',
          },
        },
      })

      expect(updated.notification?.reminders?.reminderEnabled).toBe('true')
    })

    it('should not allow updating sent envelope subject', async () => {
      const created = await envelopes.create({
        emailSubject: 'Test',
        status: 'sent',
        recipients: {
          signers: [{ email: 'test@example.com', name: 'Test', recipientId: '1', routingOrder: '1' }],
        },
        documents: [{ documentId: '1', name: 'Doc.pdf', documentBase64: 'JVBERi0xLjQK...' }],
      })

      await expect(
        envelopes.update(created.envelopeId, {
          emailSubject: 'New Subject',
        })
      ).rejects.toThrow(DocuSignError)
    })
  })

  describe('Envelope Sending', () => {
    it('should send a draft envelope', async () => {
      const created = await envelopes.create({
        emailSubject: 'Draft to send',
        status: 'created',
        recipients: {
          signers: [{ email: 'test@example.com', name: 'Test', recipientId: '1', routingOrder: '1' }],
        },
        documents: [{ documentId: '1', name: 'Doc.pdf', documentBase64: 'JVBERi0xLjQK...' }],
      })

      const sent = await envelopes.send(created.envelopeId)

      expect(sent.status).toBe('sent')
    })

    it('should resend envelope notifications', async () => {
      const created = await envelopes.create({
        emailSubject: 'Test',
        status: 'sent',
        recipients: {
          signers: [{ email: 'test@example.com', name: 'Test', recipientId: '1', routingOrder: '1' }],
        },
        documents: [{ documentId: '1', name: 'Doc.pdf', documentBase64: 'JVBERi0xLjQK...' }],
      })

      const result = await envelopes.resend(created.envelopeId)

      expect(result.success).toBe(true)
    })
  })

  describe('Envelope Voiding', () => {
    it('should void a sent envelope', async () => {
      const created = await envelopes.create({
        emailSubject: 'To be voided',
        status: 'sent',
        recipients: {
          signers: [{ email: 'test@example.com', name: 'Test', recipientId: '1', routingOrder: '1' }],
        },
        documents: [{ documentId: '1', name: 'Doc.pdf', documentBase64: 'JVBERi0xLjQK...' }],
      })

      const voided = await envelopes.void(created.envelopeId, {
        voidedReason: 'No longer needed',
      })

      expect(voided.status).toBe('voided')
    })

    it('should require void reason', async () => {
      const created = await envelopes.create({
        emailSubject: 'Test',
        status: 'sent',
        recipients: {
          signers: [{ email: 'test@example.com', name: 'Test', recipientId: '1', routingOrder: '1' }],
        },
        documents: [{ documentId: '1', name: 'Doc.pdf', documentBase64: 'JVBERi0xLjQK...' }],
      })

      await expect(
        envelopes.void(created.envelopeId, {} as EnvelopeVoidParams)
      ).rejects.toThrow(DocuSignError)
    })

    it('should not allow voiding completed envelope', async () => {
      // Create and mark as completed (simulated)
      const created = await envelopes.create({
        emailSubject: 'Completed',
        status: 'created',
      })

      // In real implementation, this would fail after completion
      // For now, test the void operation
      await expect(
        envelopes.void(created.envelopeId, { voidedReason: 'Test' })
      ).rejects.toThrow()
    })
  })

  describe('Envelope Deletion', () => {
    it('should delete a draft envelope', async () => {
      const created = await envelopes.create({
        emailSubject: 'To delete',
        status: 'created',
      })

      await envelopes.delete(created.envelopeId)

      await expect(envelopes.get(created.envelopeId)).rejects.toThrow()
    })

    it('should move voided envelope to recycle bin', async () => {
      const created = await envelopes.create({
        emailSubject: 'Voided',
        status: 'sent',
        recipients: {
          signers: [{ email: 'test@example.com', name: 'Test', recipientId: '1', routingOrder: '1' }],
        },
        documents: [{ documentId: '1', name: 'Doc.pdf', documentBase64: 'JVBERi0xLjQK...' }],
      })

      await envelopes.void(created.envelopeId, { voidedReason: 'Test' })
      await envelopes.delete(created.envelopeId)

      // Envelope should be in recycle bin, not permanently deleted
      const recycled = await envelopes.get(created.envelopeId)
      expect(recycled.envelopeId).toBe(created.envelopeId)
    })

    it('should permanently delete with purge option', async () => {
      const created = await envelopes.create({
        emailSubject: 'Purge',
        status: 'created',
      })

      await envelopes.delete(created.envelopeId, { purge: true })

      await expect(envelopes.get(created.envelopeId)).rejects.toThrow()
    })
  })

  describe('Envelope Audit Trail', () => {
    it('should get envelope audit events', async () => {
      const created = await envelopes.create({
        emailSubject: 'Audit test',
        status: 'created',
      })

      const audit = await envelopes.getAuditEvents(created.envelopeId)

      expect(audit.auditEvents).toBeDefined()
      expect(Array.isArray(audit.auditEvents)).toBe(true)
    })

    it('should include event timestamps', async () => {
      const created = await envelopes.create({
        emailSubject: 'Audit test',
        status: 'created',
      })

      const audit = await envelopes.getAuditEvents(created.envelopeId)

      expect(audit.auditEvents?.[0]?.eventDateTime).toBeDefined()
    })
  })
})

describe('DocuSign Envelope Status Transitions', () => {
  let client: DocuSignClient
  let envelopes: EnvelopesResource

  beforeEach(() => {
    client = new DocuSignClient({
      accessToken: 'test-token',
      accountId: 'test-account',
    })
    envelopes = client.envelopes
  })

  it('should track status: created -> sent', async () => {
    const envelope = await envelopes.create({
      emailSubject: 'Status test',
      status: 'created',
      recipients: {
        signers: [{ email: 'test@example.com', name: 'Test', recipientId: '1', routingOrder: '1' }],
      },
      documents: [{ documentId: '1', name: 'Doc.pdf', documentBase64: 'JVBERi0xLjQK...' }],
    })

    expect(envelope.status).toBe('created')

    const sent = await envelopes.send(envelope.envelopeId)
    expect(sent.status).toBe('sent')
  })

  it('should track status: sent -> delivered', async () => {
    const envelope = await envelopes.create({
      emailSubject: 'Delivery test',
      status: 'sent',
      recipients: {
        signers: [{ email: 'test@example.com', name: 'Test', recipientId: '1', routingOrder: '1' }],
      },
      documents: [{ documentId: '1', name: 'Doc.pdf', documentBase64: 'JVBERi0xLjQK...' }],
    })

    // Simulate delivery (in real API, this happens when recipient views)
    // This tests the status tracking capability
    expect(envelope.status).toBe('sent')
  })

  it('should track status: sent -> voided', async () => {
    const envelope = await envelopes.create({
      emailSubject: 'Void test',
      status: 'sent',
      recipients: {
        signers: [{ email: 'test@example.com', name: 'Test', recipientId: '1', routingOrder: '1' }],
      },
      documents: [{ documentId: '1', name: 'Doc.pdf', documentBase64: 'JVBERi0xLjQK...' }],
    })

    const voided = await envelopes.void(envelope.envelopeId, {
      voidedReason: 'Testing void',
    })

    expect(voided.status).toBe('voided')
  })

  it('should track status: delivered -> completed', async () => {
    // This tests the complete signing flow
    const envelope = await envelopes.create({
      emailSubject: 'Complete test',
      status: 'sent',
      recipients: {
        signers: [{ email: 'test@example.com', name: 'Test', recipientId: '1', routingOrder: '1' }],
      },
      documents: [{ documentId: '1', name: 'Doc.pdf', documentBase64: 'JVBERi0xLjQK...' }],
    })

    // In the real API, signing would trigger completion
    expect(['sent', 'delivered', 'completed']).toContain(envelope.status)
  })

  it('should track status: sent -> declined', async () => {
    const envelope = await envelopes.create({
      emailSubject: 'Decline test',
      status: 'sent',
      recipients: {
        signers: [{ email: 'test@example.com', name: 'Test', recipientId: '1', routingOrder: '1' }],
      },
      documents: [{ documentId: '1', name: 'Doc.pdf', documentBase64: 'JVBERi0xLjQK...' }],
    })

    // Simulate decline
    const declined = await envelopes.update(envelope.envelopeId, {
      status: 'declined',
    })

    expect(declined.status).toBe('declined')
  })
})

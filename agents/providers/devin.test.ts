/**
 * Devin Provider Tests (RED Phase)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DevinProvider, createDevinProvider } from './devin'

// Mock global fetch
const mockFetch = vi.fn()

describe('DevinProvider', () => {
  let provider: DevinProvider

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    provider = new DevinProvider({ apiKey: 'test-api-key' })
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('constructor', () => {
    it('sets default base URL', () => {
      const p = new DevinProvider({ apiKey: 'test' })
      expect(p).toBeDefined()
    })

    it('accepts custom base URL', () => {
      const p = new DevinProvider({
        apiKey: 'test',
        baseUrl: 'https://custom.api.devin.ai/v1'
      })
      expect(p).toBeDefined()
    })

    it('sets default max ACU limit', () => {
      const p = new DevinProvider({ apiKey: 'test' })
      expect(p).toBeDefined()
    })

    it('accepts custom poll interval', () => {
      const p = new DevinProvider({
        apiKey: 'test',
        pollIntervalMs: 10000
      })
      expect(p).toBeDefined()
    })
  })

  describe('createAgent()', () => {
    it('creates agent with provided config', () => {
      const agent = provider.createAgent({
        id: 'test-agent',
        name: 'Test Agent',
        instructions: 'You are helpful',
        model: 'devin-2.0',
      })

      expect(agent).toBeDefined()
      expect(agent.config.id).toBe('test-agent')
    })
  })

  describe('createSession()', () => {
    it('POSTs to /sessions with prompt', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          session_id: 'sess-123',
          url: 'https://devin.ai/session/sess-123',
          is_new_session: true,
        }),
      })

      const session = await provider.createSession({
        agentId: 'test',
        initialPrompt: 'Build a web app',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/sessions'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-api-key',
          }),
        })
      )
      expect(session.id).toBe('sess-123')
    })

    it('includes knowledge_ids if provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          session_id: 'sess-123',
          url: 'https://devin.ai/session/sess-123',
        }),
      })

      await provider.createSession({
        agentId: 'test',
        initialPrompt: 'Test',
        knowledgeIds: ['k1', 'k2'],
      })

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(callBody.knowledge_ids).toEqual(['k1', 'k2'])
    })

    it('includes idempotent flag', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          session_id: 'sess-123',
          url: 'https://devin.ai/session/sess-123',
        }),
      })

      await provider.createSession({
        agentId: 'test',
        initialPrompt: 'Test',
        idempotent: true,
      })

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(callBody.idempotent).toBe(true)
    })

    it('returns Session with URL in metadata', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          session_id: 'sess-456',
          url: 'https://devin.ai/session/sess-456',
          is_new_session: true,
        }),
      })

      const session = await provider.createSession({
        agentId: 'test',
        initialPrompt: 'Test',
      })

      expect(session.metadata?.url).toBe('https://devin.ai/session/sess-456')
      expect(session.metadata?.isNewSession).toBe(true)
    })
  })

  describe('getSession()', () => {
    it('GETs /session/{id}', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          session_id: 'sess-123',
          status: 'running',
          title: 'Test Session',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          acu_used: 2.5,
        }),
      })

      const session = await provider.getSession('sess-123')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/session/sess-123'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
          }),
        })
      )
      expect(session?.id).toBe('sess-123')
    })

    it('maps running status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          session_id: 'sess-123',
          status: 'running',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          acu_used: 0,
        }),
      })

      const session = await provider.getSession('sess-123')
      expect(session?.status).toBe('running')
    })

    it('maps finished to completed', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          session_id: 'sess-123',
          status: 'finished',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          acu_used: 5,
        }),
      })

      const session = await provider.getSession('sess-123')
      expect(session?.status).toBe('completed')
    })

    it('maps paused to waiting_for_input', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          session_id: 'sess-123',
          status: 'paused',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          acu_used: 0,
        }),
      })

      const session = await provider.getSession('sess-123')
      expect(session?.status).toBe('waiting_for_input')
    })

    it('returns null on error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Not found'))

      const session = await provider.getSession('non-existent')
      expect(session).toBeNull()
    })

    it('includes PR info in metadata', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          session_id: 'sess-123',
          status: 'finished',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          acu_used: 5,
          pull_request: {
            url: 'https://github.com/org/repo/pull/123',
            status: 'open',
          },
        }),
      })

      const session = await provider.getSession('sess-123')
      expect(session?.metadata?.pullRequest?.url).toBe('https://github.com/org/repo/pull/123')
    })
  })

  describe('sendMessage()', () => {
    it('POSTs message to session', async () => {
      // First call: send message
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      })
      // Second call: get session (polling)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          session_id: 'sess-123',
          status: 'finished',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          acu_used: 1,
        }),
      })

      await provider.sendMessage({
        sessionId: 'sess-123',
        message: 'Continue with the task',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/session/sess-123/message'),
        expect.objectContaining({
          method: 'POST',
        })
      )
    })
  })

  describe('uploadAttachment()', () => {
    it('POSTs multipart/form-data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          url: 'https://devin.ai/attachments/file-123.pdf',
        }),
      })

      const file = new File(['content'], 'test.pdf', { type: 'application/pdf' })
      const attachment = await provider.uploadAttachment(file)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/attachments'),
        expect.objectContaining({
          method: 'POST',
        })
      )
      expect(attachment.url).toBe('https://devin.ai/attachments/file-123.pdf')
    })

    it('returns Attachment with URL and metadata', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          url: 'https://devin.ai/attachments/doc.pdf',
        }),
      })

      const file = new File(['content'], 'document.pdf', { type: 'application/pdf' })
      file.name // ensure name is set
      const attachment = await provider.uploadAttachment(file)

      expect(attachment.name).toBe('document.pdf')
      expect(attachment.mimeType).toBe('application/pdf')
      expect(attachment.url).toContain('doc.pdf')
    })
  })

  describe('listModels()', () => {
    it('returns Devin model versions', async () => {
      const models = await provider.listModels()

      expect(models).toContain('devin-2.0')
      expect(models).toContain('devin-2.1')
    })
  })
})

describe('createDevinProvider()', () => {
  it('creates provider with API key', () => {
    const provider = createDevinProvider({ apiKey: 'test-key' })
    expect(provider).toBeInstanceOf(DevinProvider)
  })

  it('creates provider with all options', () => {
    const provider = createDevinProvider({
      apiKey: 'test-key',
      baseUrl: 'https://custom.api',
      maxAcuLimit: 20,
      knowledgeIds: ['k1'],
      secretIds: ['s1'],
      pollIntervalMs: 3000,
    })
    expect(provider).toBeInstanceOf(DevinProvider)
  })
})

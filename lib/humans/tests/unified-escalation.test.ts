import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  HttpEscalationProvider,
  DOEscalationProvider,
  EscalationRequestHandle,
  configureEscalationProvider,
  configureRoleProvider,
  getEscalationProvider,
  clearProviderConfig,
  createEscalationRequest,
  type HumanEscalationProvider,
  type EscalationRequest,
  type HumanDOStub,
} from '../escalation'
import { HumanTimeoutError } from '../templates'

describe('Unified Escalation Abstraction', () => {
  beforeEach(() => {
    clearProviderConfig()
  })

  afterEach(() => {
    clearProviderConfig()
  })

  describe('HttpEscalationProvider', () => {
    it('should create provider with config', () => {
      const provider = new HttpEscalationProvider({
        baseUrl: 'https://api.test.com/human',
      })
      expect(provider).toBeDefined()
    })

    it('should submit escalation request', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            requestId: 'test-123',
            role: 'ceo',
            message: 'approve this',
            status: 'pending',
            createdAt: new Date().toISOString(),
          }),
      })

      const provider = new HttpEscalationProvider({
        baseUrl: 'https://api.test.com/human',
        fetch: mockFetch,
      })

      const result = await provider.submit({
        requestId: 'test-123',
        role: 'ceo',
        message: 'approve this',
        type: 'approval',
      })

      expect(result.status).toBe('pending')
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/human/request',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      )
    })

    it('should get request status', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            requestId: 'test-123',
            role: 'ceo',
            message: 'approve this',
            status: 'approved',
            createdAt: new Date().toISOString(),
            result: {
              approved: true,
              approver: 'john@test.com',
              reason: 'looks good',
            },
          }),
      })

      const provider = new HttpEscalationProvider({
        baseUrl: 'https://api.test.com/human',
        fetch: mockFetch,
      })

      const result = await provider.getStatus('test-123')

      expect(result?.status).toBe('approved')
      expect(result?.result?.approved).toBe(true)
      expect(result?.result?.approver).toBe('john@test.com')
    })

    it('should return null for non-existent request', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      })

      const provider = new HttpEscalationProvider({
        baseUrl: 'https://api.test.com/human',
        fetch: mockFetch,
      })

      const result = await provider.getStatus('nonexistent')
      expect(result).toBeNull()
    })

    it('should cancel request', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ cancelled: true }),
      })

      const provider = new HttpEscalationProvider({
        baseUrl: 'https://api.test.com/human',
        fetch: mockFetch,
      })

      const result = await provider.cancel('test-123')
      expect(result).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/human/request/test-123',
        expect.objectContaining({ method: 'DELETE' })
      )
    })
  })

  describe('DOEscalationProvider', () => {
    it('should create provider with DO stub', () => {
      const mockDO: HumanDOStub = {
        submitBlockingRequest: vi.fn(),
        getBlockingRequest: vi.fn(),
        respondToBlockingRequest: vi.fn(),
        cancelBlockingRequest: vi.fn(),
      }

      const provider = new DOEscalationProvider({
        humanDO: mockDO,
        role: 'ceo',
      })
      expect(provider).toBeDefined()
    })

    it('should submit request via DO stub', async () => {
      const mockDO: HumanDOStub = {
        submitBlockingRequest: vi.fn().mockResolvedValue({
          requestId: 'test-123',
          role: 'ceo',
          message: 'approve this',
          status: 'pending',
          createdAt: new Date().toISOString(),
        }),
        getBlockingRequest: vi.fn(),
        respondToBlockingRequest: vi.fn(),
        cancelBlockingRequest: vi.fn(),
      }

      const provider = new DOEscalationProvider({
        humanDO: mockDO,
        role: 'ceo',
      })

      const result = await provider.submit({
        requestId: 'test-123',
        role: 'ceo',
        message: 'approve this',
        type: 'approval',
      })

      expect(result.status).toBe('pending')
      expect(mockDO.submitBlockingRequest).toHaveBeenCalledWith({
        requestId: 'test-123',
        role: 'ceo',
        message: 'approve this',
        sla: undefined,
        channel: undefined,
        type: 'approval',
      })
    })

    it('should get status via DO stub', async () => {
      const mockDO: HumanDOStub = {
        submitBlockingRequest: vi.fn(),
        getBlockingRequest: vi.fn().mockResolvedValue({
          requestId: 'test-123',
          role: 'ceo',
          message: 'approve this',
          status: 'approved',
          createdAt: new Date().toISOString(),
          result: {
            approved: true,
            approver: 'jane@test.com',
          },
        }),
        respondToBlockingRequest: vi.fn(),
        cancelBlockingRequest: vi.fn(),
      }

      const provider = new DOEscalationProvider({
        humanDO: mockDO,
        role: 'ceo',
      })

      const result = await provider.getStatus('test-123')

      expect(result?.status).toBe('approved')
      expect(result?.result?.approved).toBe(true)
    })

    it('should cancel via DO stub', async () => {
      const mockDO: HumanDOStub = {
        submitBlockingRequest: vi.fn(),
        getBlockingRequest: vi.fn(),
        respondToBlockingRequest: vi.fn(),
        cancelBlockingRequest: vi.fn().mockResolvedValue(true),
      }

      const provider = new DOEscalationProvider({
        humanDO: mockDO,
        role: 'ceo',
      })

      const result = await provider.cancel('test-123')
      expect(result).toBe(true)
      expect(mockDO.cancelBlockingRequest).toHaveBeenCalledWith('test-123')
    })
  })

  describe('Provider Registry', () => {
    it('should configure default provider', () => {
      const mockProvider: HumanEscalationProvider = {
        submit: vi.fn(),
        getStatus: vi.fn(),
        waitForResponse: vi.fn(),
        cancel: vi.fn(),
      }

      configureEscalationProvider(mockProvider)
      const provider = getEscalationProvider('any-role')
      expect(provider).toBe(mockProvider)
    })

    it('should configure role-specific provider', () => {
      const ceoProvider: HumanEscalationProvider = {
        submit: vi.fn(),
        getStatus: vi.fn(),
        waitForResponse: vi.fn(),
        cancel: vi.fn(),
      }

      const defaultProvider: HumanEscalationProvider = {
        submit: vi.fn(),
        getStatus: vi.fn(),
        waitForResponse: vi.fn(),
        cancel: vi.fn(),
      }

      configureEscalationProvider(defaultProvider)
      configureRoleProvider('ceo', ceoProvider)

      expect(getEscalationProvider('ceo')).toBe(ceoProvider)
      expect(getEscalationProvider('legal')).toBe(defaultProvider)
    })

    it('should create default HTTP provider when none configured', () => {
      const provider = getEscalationProvider('ceo')
      expect(provider).toBeDefined()
      expect(provider.constructor.name).toBe('HttpEscalationProvider')
    })

    it('should clear all providers', () => {
      const mockProvider: HumanEscalationProvider = {
        submit: vi.fn(),
        getStatus: vi.fn(),
        waitForResponse: vi.fn(),
        cancel: vi.fn(),
      }

      configureEscalationProvider(mockProvider)
      clearProviderConfig()

      // After clearing, should create a new default provider
      const provider = getEscalationProvider('ceo')
      expect(provider).not.toBe(mockProvider)
    })
  })

  describe('EscalationRequestHandle', () => {
    it('should be awaitable (implements PromiseLike)', async () => {
      const mockProvider: HumanEscalationProvider = {
        submit: vi.fn().mockResolvedValue({ status: 'pending' }),
        getStatus: vi.fn(),
        waitForResponse: vi.fn().mockResolvedValue({
          approved: true,
          approver: 'ceo@test.com',
          requestId: 'test-123',
        }),
        cancel: vi.fn(),
      }

      configureEscalationProvider(mockProvider)

      const handle = createEscalationRequest({
        role: 'ceo',
        message: 'approve this',
      })

      expect(typeof handle.then).toBe('function')

      const result = await handle
      expect(result.approved).toBe(true)
    })

    it('should expose request properties', () => {
      const mockProvider: HumanEscalationProvider = {
        submit: vi.fn().mockResolvedValue({ status: 'pending' }),
        getStatus: vi.fn(),
        waitForResponse: vi.fn().mockResolvedValue({ approved: true }),
        cancel: vi.fn(),
      }

      configureEscalationProvider(mockProvider)

      const handle = createEscalationRequest({
        role: 'ceo',
        message: 'approve this',
        sla: 3600000,
        channel: 'slack',
      })

      expect(handle.role).toBe('ceo')
      expect(handle.message).toBe('approve this')
      expect(handle.sla).toBe(3600000)
      expect(handle.channel).toBe('slack')
      expect(handle.requestId).toBeDefined()
    })

    it('should support timeout() chaining', () => {
      const mockProvider: HumanEscalationProvider = {
        submit: vi.fn().mockResolvedValue({ status: 'pending' }),
        getStatus: vi.fn(),
        waitForResponse: vi.fn().mockResolvedValue({ approved: true }),
        cancel: vi.fn(),
      }

      configureEscalationProvider(mockProvider)

      const handle = createEscalationRequest({
        role: 'ceo',
        message: 'approve this',
      })

      const withTimeout = handle.timeout('4 hours')
      expect(withTimeout.sla).toBe(14400000)
      expect(withTimeout.role).toBe('ceo')
      expect(withTimeout.message).toBe('approve this')
    })

    it('should support via() chaining', () => {
      const mockProvider: HumanEscalationProvider = {
        submit: vi.fn().mockResolvedValue({ status: 'pending' }),
        getStatus: vi.fn(),
        waitForResponse: vi.fn().mockResolvedValue({ approved: true }),
        cancel: vi.fn(),
      }

      configureEscalationProvider(mockProvider)

      const handle = createEscalationRequest({
        role: 'ceo',
        message: 'approve this',
      })

      const withChannel = handle.via('slack')
      expect(withChannel.channel).toBe('slack')
      expect(withChannel.role).toBe('ceo')
      expect(withChannel.message).toBe('approve this')
    })

    it('should support cancel()', async () => {
      const mockProvider: HumanEscalationProvider = {
        submit: vi.fn().mockResolvedValue({ status: 'pending' }),
        getStatus: vi.fn(),
        waitForResponse: vi.fn().mockImplementation(() => new Promise(() => {})), // Never resolves
        cancel: vi.fn().mockResolvedValue(true),
      }

      configureEscalationProvider(mockProvider)

      const handle = createEscalationRequest({
        role: 'ceo',
        message: 'approve this',
      })

      const cancelled = await handle.cancel()
      expect(cancelled).toBe(true)
      expect(mockProvider.cancel).toHaveBeenCalledWith(handle.requestId)
    })

    it('should support getStatus()', async () => {
      const mockProvider: HumanEscalationProvider = {
        submit: vi.fn().mockResolvedValue({ status: 'pending' }),
        getStatus: vi.fn().mockResolvedValue({
          status: 'pending',
          createdAt: new Date().toISOString(),
        }),
        waitForResponse: vi.fn().mockImplementation(() => new Promise(() => {})),
        cancel: vi.fn(),
      }

      configureEscalationProvider(mockProvider)

      const handle = createEscalationRequest({
        role: 'ceo',
        message: 'approve this',
      })

      const status = await handle.getStatus()
      expect(status?.status).toBe('pending')
    })
  })

  describe('createEscalationRequest', () => {
    it('should create request with provided options', () => {
      const mockProvider: HumanEscalationProvider = {
        submit: vi.fn().mockResolvedValue({ status: 'pending' }),
        getStatus: vi.fn(),
        waitForResponse: vi.fn().mockResolvedValue({ approved: true }),
        cancel: vi.fn(),
      }

      const handle = createEscalationRequest({
        role: 'legal',
        message: 'review contract',
        sla: '2 hours',
        channel: 'email',
        type: 'review',
        provider: mockProvider,
      })

      expect(handle.role).toBe('legal')
      expect(handle.message).toBe('review contract')
      expect(handle.sla).toBe(7200000) // 2 hours in ms
      expect(handle.channel).toBe('email')
      expect(handle.type).toBe('review')
    })

    it('should generate request ID if not provided', () => {
      const mockProvider: HumanEscalationProvider = {
        submit: vi.fn().mockResolvedValue({ status: 'pending' }),
        getStatus: vi.fn(),
        waitForResponse: vi.fn().mockResolvedValue({ approved: true }),
        cancel: vi.fn(),
      }

      const handle = createEscalationRequest({
        role: 'ceo',
        message: 'approve this',
        provider: mockProvider,
      })

      expect(handle.requestId).toBeDefined()
      expect(handle.requestId.startsWith('esc-')).toBe(true)
    })

    it('should use provided request ID', () => {
      const mockProvider: HumanEscalationProvider = {
        submit: vi.fn().mockResolvedValue({ status: 'pending' }),
        getStatus: vi.fn(),
        waitForResponse: vi.fn().mockResolvedValue({ approved: true }),
        cancel: vi.fn(),
      }

      const handle = createEscalationRequest({
        role: 'ceo',
        message: 'approve this',
        requestId: 'custom-id-123',
        provider: mockProvider,
      })

      expect(handle.requestId).toBe('custom-id-123')
    })
  })

  describe('Integration: Template Literal Pattern', () => {
    it('should work with DOEscalationProvider for direct DO access', async () => {
      // Simulate a Human DO stub
      const mockDO: HumanDOStub = {
        submitBlockingRequest: vi.fn().mockResolvedValue({
          requestId: 'do-test-123',
          role: 'ceo',
          message: 'approve partnership',
          status: 'pending',
          createdAt: new Date().toISOString(),
        }),
        getBlockingRequest: vi.fn().mockResolvedValue({
          requestId: 'do-test-123',
          role: 'ceo',
          message: 'approve partnership',
          status: 'approved',
          createdAt: new Date().toISOString(),
          result: {
            approved: true,
            approver: 'ceo@company.com',
            reason: 'Strategic fit',
          },
        }),
        respondToBlockingRequest: vi.fn(),
        cancelBlockingRequest: vi.fn(),
      }

      // Configure DO provider for CEO role
      const doProvider = new DOEscalationProvider({
        humanDO: mockDO,
        role: 'ceo',
      })
      configureRoleProvider('ceo', doProvider)

      // Use createEscalationRequest (simulating template literal behavior)
      const result = await createEscalationRequest({
        role: 'ceo',
        message: 'approve partnership',
        sla: 14400000,
      })

      expect(result.approved).toBe(true)
      expect(result.approver).toBe('ceo@company.com')
      expect(mockDO.submitBlockingRequest).toHaveBeenCalled()
    })

    it('should fall back to HTTP provider when DO not available', async () => {
      // No provider configured - should create default HTTP provider
      clearProviderConfig()

      const provider = getEscalationProvider('legal')
      expect(provider.constructor.name).toBe('HttpEscalationProvider')
    })
  })
})

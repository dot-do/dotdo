import { describe, it, expect, vi } from 'vitest'
import { createUserProxy, type UserProxyConfig } from '../user'

describe('$.user.* Context API', () => {
  const createMockStub = () => ({
    id: { toString: () => 'user-id' },
    fetch: vi.fn().mockImplementation((request: Request) => {
      const url = new URL(request.url)
      const path = url.pathname

      // Return appropriate response based on endpoint
      if (path === '/confirm') {
        return Promise.resolve(new Response(JSON.stringify({ confirmed: true })))
      } else if (path === '/prompt') {
        return Promise.resolve(new Response(JSON.stringify({ answer: 'test@example.com' })))
      } else if (path === '/select') {
        return Promise.resolve(new Response(JSON.stringify({ selected: 'medium' })))
      } else if (path === '/notify') {
        return Promise.resolve(new Response(JSON.stringify({ sent: true })))
      } else if (path === '/chat') {
        return Promise.resolve(new Response(JSON.stringify({ conversationId: 'conv-123' })))
      }
      return Promise.resolve(new Response(JSON.stringify({ confirmed: true })))
    }),
  })

  const mockEnv = {
    USER_DO: {
      idFromName: vi.fn().mockReturnValue({ toString: () => 'user-id' }),
      get: vi.fn().mockImplementation(() => createMockStub()),
    },
  }

  it('should export createUserProxy factory', () => {
    expect(typeof createUserProxy).toBe('function')
  })

  describe('$.user.confirm()', () => {
    it('should ask user for confirmation', async () => {
      const { user } = createUserProxy({ env: mockEnv })
      const result = await user.confirm('Delete this item?')
      expect(result).toBe(true)
    })

    it('should support options', async () => {
      const { user } = createUserProxy({ env: mockEnv })
      const result = await user.confirm('Proceed?', {
        timeout: 30000,
        default: false,
      })
      expect(typeof result).toBe('boolean')
    })
  })

  describe('$.user.prompt()', () => {
    it('should get text input from user', async () => {
      const { user } = createUserProxy({ env: mockEnv })
      const result = await user.prompt('Enter your name')
      expect(typeof result).toBe('string')
    })

    it('should support placeholder and validation', async () => {
      const { user } = createUserProxy({ env: mockEnv })
      const result = await user.prompt('Email', {
        placeholder: 'you@example.com',
        validate: (v) => v.includes('@'),
      })
      expect(result).toBeTruthy()
    })
  })

  describe('$.user.select()', () => {
    it('should show options to user', async () => {
      const { user } = createUserProxy({ env: mockEnv })
      const result = await user.select('Choose size', ['small', 'medium', 'large'])
      expect(['small', 'medium', 'large']).toContain(result)
    })
  })

  describe('$.user.notify()', () => {
    it('should send notification without waiting', async () => {
      const { user } = createUserProxy({ env: mockEnv })
      await user.notify('Your order has shipped!')
      // fire-and-forget, should not throw
    })
  })

  describe('$.user.chat()', () => {
    it('should open chat interface for conversation', async () => {
      const { user } = createUserProxy({ env: mockEnv })
      const conversation = await user.chat('How can I help?')
      expect(conversation).toHaveProperty('messages')
      expect(conversation).toHaveProperty('close')
    })
  })
})

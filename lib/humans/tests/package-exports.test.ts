import { describe, it, expect } from 'vitest'

describe('humans.do Package Exports', () => {
  it('should export from humans.do entry', async () => {
    const humansDo = await import('humans.do')
    expect(humansDo).toBeDefined()
  })

  describe('Role Templates', () => {
    it('should export ceo template', async () => {
      const { ceo } = await import('humans.do')
      expect(typeof ceo).toBe('function')
    })

    it('should export legal template', async () => {
      const { legal } = await import('humans.do')
      expect(typeof legal).toBe('function')
    })

    it('should export cfo template', async () => {
      const { cfo } = await import('humans.do')
      expect(typeof cfo).toBe('function')
    })

    it('should export cto template', async () => {
      const { cto } = await import('humans.do')
      expect(typeof cto).toBe('function')
    })

    it('should export hr template', async () => {
      const { hr } = await import('humans.do')
      expect(typeof hr).toBe('function')
    })

    it('should export support template', async () => {
      const { support } = await import('humans.do')
      expect(typeof support).toBe('function')
    })

    it('should export manager template', async () => {
      const { manager } = await import('humans.do')
      expect(typeof manager).toBe('function')
    })
  })

  describe('Factory Functions', () => {
    it('should export createHumanTemplate', async () => {
      const { createHumanTemplate } = await import('humans.do')
      expect(typeof createHumanTemplate).toBe('function')
    })

    it('should export HumanFunction class', async () => {
      const { HumanFunction } = await import('humans.do')
      expect(typeof HumanFunction).toBe('function')
    })

    it('should export createHumanProxy', async () => {
      const { createHumanProxy } = await import('humans.do')
      expect(typeof createHumanProxy).toBe('function')
    })

    it('should export createUserProxy', async () => {
      const { createUserProxy } = await import('humans.do')
      expect(typeof createUserProxy).toBe('function')
    })
  })

  describe('Channel Exports', () => {
    it('should export SlackBlockKitChannel', async () => {
      const { SlackBlockKitChannel } = await import('humans.do')
      expect(typeof SlackBlockKitChannel).toBe('function')
    })

    it('should export DiscordChannel', async () => {
      const { DiscordChannel } = await import('humans.do')
      expect(typeof DiscordChannel).toBe('function')
    })

    it('should export EmailChannel', async () => {
      const { EmailChannel } = await import('humans.do')
      expect(typeof EmailChannel).toBe('function')
    })

    it('should export MDXUIChatChannel', async () => {
      const { MDXUIChatChannel } = await import('humans.do')
      expect(typeof MDXUIChatChannel).toBe('function')
    })
  })
})

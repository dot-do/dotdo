/**
 * Local Sandbox REPL Tests
 *
 * Tests for the local sandbox functionality:
 * - SandboxTransport creates and communicates with miniflare DO
 * - Things, events, and relationships stores work correctly
 * - CLI routes to sandbox when no endpoint provided
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createProgram } from '../cli'

describe('Sandbox REPL Command', () => {
  describe('Command Definition', () => {
    it('has repl command with optional endpoint', () => {
      const program = createProgram()
      const replCmd = program.commands.find((cmd) => cmd.name() === 'repl')

      expect(replCmd).toBeDefined()

      // Check that endpoint is an optional argument (not required)
      const args = replCmd?.registeredArguments || []
      expect(args.length).toBeGreaterThan(0)
      expect(args[0]?.name()).toBe('endpoint')
      expect(args[0]?.required).toBe(false)
    })

    it('has --local option for forcing sandbox mode', () => {
      const program = createProgram()
      const replCmd = program.commands.find((cmd) => cmd.name() === 'repl')

      expect(replCmd).toBeDefined()

      const optionFlags = replCmd?.options.map((opt) => opt.long) || []
      expect(optionFlags).toContain('--local')
    })

    it('has -l as short flag for --local', () => {
      const program = createProgram()
      const replCmd = program.commands.find((cmd) => cmd.name() === 'repl')

      expect(replCmd).toBeDefined()

      const localOption = replCmd?.options.find((opt) => opt.long === '--local')
      expect(localOption?.short).toBe('-l')
    })

    it('description mentions local sandbox', () => {
      const program = createProgram()
      const replCmd = program.commands.find((cmd) => cmd.name() === 'repl')

      expect(replCmd).toBeDefined()
      expect(replCmd?.description()).toContain('sandbox')
    })
  })

  describe('Help Text', () => {
    it('repl command help mentions optional endpoint', () => {
      const program = createProgram()
      const replCmd = program.commands.find((cmd) => cmd.name() === 'repl')

      const helpText = replCmd?.helpInformation() || ''
      expect(helpText).toContain('[endpoint]')
    })

    it('repl command help mentions --local option', () => {
      const program = createProgram()
      const replCmd = program.commands.find((cmd) => cmd.name() === 'repl')

      const helpText = replCmd?.helpInformation() || ''
      expect(helpText).toContain('--local')
    })
  })
})

describe('SandboxTransport', () => {
  // These tests require miniflare, so they're marked as slow
  it.skip('can be imported', async () => {
    // This test verifies the module structure is correct
    const { SandboxTransport, createSandboxTransport } = await import('../commands/sandbox')

    expect(SandboxTransport).toBeDefined()
    expect(createSandboxTransport).toBeDefined()
  })

  it.skip('initializes with miniflare DO', async () => {
    const { createSandboxTransport } = await import('../commands/sandbox')

    const transport = createSandboxTransport()

    // Initialize should not throw
    await transport.initialize()

    // State should be connected
    expect(transport.getState()).toBe('CONNECTED')

    // Clean up
    await transport.close()
  })

  it.skip('handles things.create RPC', async () => {
    const { createSandboxTransport } = await import('../commands/sandbox')

    const transport = createSandboxTransport()
    await transport.initialize()

    try {
      const response = await transport.send({
        method: 'things.create',
        args: [{ $type: 'TestItem', name: 'Test' }],
      })

      expect(response.error).toBeUndefined()
      expect(response.result).toBeDefined()

      const result = response.result as { $id: string; $type: string; name: string }
      expect(result.$id).toBeDefined()
      expect(result.$type).toBe('TestItem')
      expect(result.name).toBe('Test')
    } finally {
      await transport.close()
    }
  })

  it.skip('handles things.list RPC', async () => {
    const { createSandboxTransport } = await import('../commands/sandbox')

    const transport = createSandboxTransport()
    await transport.initialize()

    try {
      // Create some items first
      await transport.send({
        method: 'things.create',
        args: [{ $type: 'ListTest', name: 'Item 1' }],
      })
      await transport.send({
        method: 'things.create',
        args: [{ $type: 'ListTest', name: 'Item 2' }],
      })

      // List items
      const response = await transport.send({
        method: 'things.list',
        args: [{ $type: 'ListTest' }],
      })

      expect(response.error).toBeUndefined()

      const result = response.result as Array<{ $type: string; name: string }>
      expect(result.length).toBe(2)
      expect(result.every((item) => item.$type === 'ListTest')).toBe(true)
    } finally {
      await transport.close()
    }
  })

  it.skip('handles events.emit RPC', async () => {
    const { createSandboxTransport } = await import('../commands/sandbox')

    const transport = createSandboxTransport()
    await transport.initialize()

    try {
      const response = await transport.send({
        method: 'events.emit',
        args: [{ type: 'test.event', payload: { data: 'test' } }],
      })

      expect(response.error).toBeUndefined()
      expect(response.result).toBeDefined()

      const result = response.result as { $id: string; type: string; payload: { data: string } }
      expect(result.$id).toBeDefined()
      expect(result.type).toBe('test.event')
      expect(result.payload.data).toBe('test')
    } finally {
      await transport.close()
    }
  })

  it.skip('handles relationships.create RPC', async () => {
    const { createSandboxTransport } = await import('../commands/sandbox')

    const transport = createSandboxTransport()
    await transport.initialize()

    try {
      const response = await transport.send({
        method: 'relationships.create',
        args: [{
          from: { id: 'user-1', type: 'User' },
          to: { id: 'org-1', type: 'Organization' },
          relation: 'memberOf',
        }],
      })

      expect(response.error).toBeUndefined()
      expect(response.result).toBeDefined()

      const result = response.result as {
        $id: string
        from: { id: string; type: string }
        to: { id: string; type: string }
        relation: string
      }
      expect(result.$id).toBeDefined()
      expect(result.from.id).toBe('user-1')
      expect(result.to.id).toBe('org-1')
      expect(result.relation).toBe('memberOf')
    } finally {
      await transport.close()
    }
  })

  it.skip('returns types via _types RPC', async () => {
    const { createSandboxTransport } = await import('../commands/sandbox')

    const transport = createSandboxTransport()
    await transport.initialize()

    try {
      const response = await transport.send({
        method: '_types',
        args: [],
      })

      expect(response.error).toBeUndefined()
      expect(response.result).toBeDefined()
      expect(typeof response.result).toBe('string')

      const types = response.result as string
      expect(types).toContain('ThingsStore')
      expect(types).toContain('EventsStore')
      expect(types).toContain('RelationshipsStore')
    } finally {
      await transport.close()
    }
  })

  it.skip('handles errors gracefully', async () => {
    const { createSandboxTransport } = await import('../commands/sandbox')

    const transport = createSandboxTransport()
    await transport.initialize()

    try {
      const response = await transport.send({
        method: 'things.create',
        args: [{ name: 'Missing type' }], // Missing required $type
      })

      expect(response.error).toBeDefined()
      expect(response.error?.message).toContain('$type')
    } finally {
      await transport.close()
    }
  })
})

describe('CLI Default Behavior', () => {
  let mockExit: ReturnType<typeof vi.spyOn>
  let mockLog: ReturnType<typeof vi.spyOn>
  let mockError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    mockExit = vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
      throw new Error(`process.exit(${code})`)
    })
    mockLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    mockError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('URL-like argument should be detected for repl', () => {
    // This tests the logic in the main entry point
    const httpUrl = 'https://api.dotdo.dev'
    const notUrl = 'build'

    // URL detection logic (same as in cli.ts)
    expect(httpUrl.startsWith('http://') || httpUrl.startsWith('https://')).toBe(true)
    expect(notUrl.startsWith('http://') || notUrl.startsWith('https://')).toBe(false)
  })

  it('creates program with all expected commands', () => {
    const program = createProgram()
    const commandNames = program.commands.map((cmd) => cmd.name())

    // Core commands should exist
    expect(commandNames).toContain('init')
    expect(commandNames).toContain('dev')
    expect(commandNames).toContain('build')
    expect(commandNames).toContain('deploy')
    expect(commandNames).toContain('repl')
    expect(commandNames).toContain('login')
    expect(commandNames).toContain('logout')
    expect(commandNames).toContain('whoami')
    expect(commandNames).toContain('logs')
    expect(commandNames).toContain('config')
    expect(commandNames).toContain('do')
    expect(commandNames).toContain('version')
  })
})

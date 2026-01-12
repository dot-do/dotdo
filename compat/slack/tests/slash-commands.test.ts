/**
 * Tests for Slack Slash Commands Handler
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  SlashCommands,
  SlashCommandError,
  parseArgs,
  verifySignature,
  commandResponse,
  ephemeral,
  inChannel,
  type CommandContext,
  type SlashCommandsOptions,
} from '../slash-commands'
import { generateSignature } from '../slack'

// =============================================================================
// Test Helpers
// =============================================================================

function createMockFetch(responses: Map<string, any> = new Map()) {
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    const urlStr = url.toString()
    const mockResponse = responses.get(urlStr) || { ok: true }

    return {
      ok: mockResponse.ok !== false,
      status: mockResponse.status || 200,
      json: async () => mockResponse,
      text: async () => JSON.stringify(mockResponse),
    } as Response
  })
}

async function createSignedRequest(
  signingSecret: string,
  body: Record<string, string>
): Promise<Request> {
  const formBody = new URLSearchParams(body).toString()
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const signature = await generateSignature(signingSecret, timestamp, formBody)

  return new Request('https://example.com/slack/commands', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-slack-request-timestamp': timestamp,
      'x-slack-signature': signature,
    },
    body: formBody,
  })
}

const defaultCommandPayload = {
  command: '/test',
  text: '',
  response_url: 'https://hooks.slack.com/commands/response',
  trigger_id: 'trigger123',
  user_id: 'U1234567890',
  user_name: 'testuser',
  team_id: 'T1234567890',
  team_domain: 'testteam',
  channel_id: 'C1234567890',
  channel_name: 'test-channel',
  api_app_id: 'A1234567890',
}

// =============================================================================
// Argument Parsing Tests
// =============================================================================

describe('parseArgs', () => {
  describe('basic parsing', () => {
    it('should parse empty string', () => {
      const result = parseArgs('')
      expect(result.raw).toBe('')
      expect(result.positional).toEqual([])
      expect(result.flags).toEqual({})
    })

    it('should parse positional arguments', () => {
      const result = parseArgs('deploy production')
      expect(result.positional).toEqual(['deploy', 'production'])
    })

    it('should parse long flags without values', () => {
      const result = parseArgs('--verbose --debug')
      expect(result.flags).toEqual({ verbose: true, debug: true })
    })

    it('should parse long flags with values using =', () => {
      const result = parseArgs('--env=production --count=5')
      expect(result.flags).toEqual({ env: 'production', count: '5' })
    })

    it('should parse long flags with values using space', () => {
      const result = parseArgs('--env production', {
        flags: { env: { hasValue: true } },
      })
      expect(result.flags).toEqual({ env: 'production' })
    })

    it('should parse short flags', () => {
      const result = parseArgs('-v -d')
      expect(result.flags).toEqual({ v: true, d: true })
    })

    it('should parse combined short flags', () => {
      const result = parseArgs('-vdf')
      expect(result.flags).toEqual({ v: true, d: true, f: true })
    })

    it('should expand short flag aliases', () => {
      const result = parseArgs('-v', {
        flags: { verbose: { alias: 'v' } },
      })
      expect(result.flags).toEqual({ verbose: true })
    })

    it('should parse short flag with value', () => {
      const result = parseArgs('-e production', {
        flags: { env: { alias: 'e', hasValue: true } },
      })
      expect(result.flags).toEqual({ env: 'production' })
    })
  })

  describe('quoted strings', () => {
    it('should handle double-quoted strings', () => {
      const result = parseArgs('message "hello world"')
      expect(result.positional).toEqual(['message', 'hello world'])
    })

    it('should handle single-quoted strings', () => {
      const result = parseArgs("message 'hello world'")
      expect(result.positional).toEqual(['message', 'hello world'])
    })

    it('should handle escaped characters', () => {
      const result = parseArgs('message "hello\\"world"')
      expect(result.positional).toEqual(['message', 'hello"world'])
    })

    it('should handle mixed quotes and flags', () => {
      const result = parseArgs('--message="hello world" --verbose')
      expect(result.flags).toEqual({ message: 'hello world', verbose: true })
    })
  })

  describe('subcommand extraction', () => {
    it('should extract subcommand from first positional', () => {
      const result = parseArgs('deploy production --verbose')
      expect(result.subcommand).toBe('deploy')
      expect(result.rest).toBe('production')
    })

    it('should not treat user mentions as subcommands', () => {
      const result = parseArgs('@user hello')
      expect(result.subcommand).toBeUndefined()
      expect(result.positional).toEqual(['@user', 'hello'])
    })

    it('should not treat special characters as subcommands', () => {
      const result = parseArgs('<@U123> hello')
      expect(result.subcommand).toBeUndefined()
    })
  })

  describe('default values', () => {
    it('should apply default flag values', () => {
      const result = parseArgs('', {
        flags: {
          verbose: { default: false },
          count: { default: '10' },
        },
      })
      expect(result.flags).toEqual({ verbose: false, count: '10' })
    })

    it('should override defaults with provided values', () => {
      const result = parseArgs('--verbose', {
        flags: {
          verbose: { default: false },
        },
      })
      expect(result.flags).toEqual({ verbose: true })
    })
  })

  describe('complex scenarios', () => {
    it('should parse git-like command', () => {
      const result = parseArgs('commit -m "Initial commit" --amend', {
        flags: {
          m: { hasValue: true },
          amend: {},
        },
      })
      expect(result.subcommand).toBe('commit')
      expect(result.flags).toEqual({ m: 'Initial commit', amend: true })
    })

    it('should parse deploy command', () => {
      const result = parseArgs('web --env=staging --force -v', {
        flags: {
          env: { hasValue: true },
          force: {},
          verbose: { alias: 'v' },
        },
      })
      expect(result.subcommand).toBe('web')
      expect(result.flags).toEqual({
        env: 'staging',
        force: true,
        verbose: true,
      })
    })
  })
})

// =============================================================================
// Signature Verification Tests
// =============================================================================

describe('verifySignature', () => {
  const signingSecret = 'test-secret-12345'

  it('should verify valid signature', async () => {
    const body = 'command=/test&text=hello'
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const signature = await generateSignature(signingSecret, timestamp, body)

    const result = await verifySignature({
      signingSecret,
      body,
      timestamp,
      signature,
    })

    expect(result).toBe(true)
  })

  it('should reject invalid signature', async () => {
    const result = await verifySignature({
      signingSecret,
      body: 'command=/test&text=hello',
      timestamp: Math.floor(Date.now() / 1000).toString(),
      signature: 'v0=invalid',
    })

    expect(result).toBe(false)
  })

  it('should reject expired timestamp', async () => {
    const body = 'command=/test&text=hello'
    const oldTimestamp = (Math.floor(Date.now() / 1000) - 600).toString()
    const signature = await generateSignature(signingSecret, oldTimestamp, body)

    const result = await verifySignature({
      signingSecret,
      body,
      timestamp: oldTimestamp,
      signature,
      maxAge: 300,
    })

    expect(result).toBe(false)
  })

  it('should reject future timestamp', async () => {
    const body = 'command=/test&text=hello'
    const futureTimestamp = (Math.floor(Date.now() / 1000) + 600).toString()
    const signature = await generateSignature(signingSecret, futureTimestamp, body)

    const result = await verifySignature({
      signingSecret,
      body,
      timestamp: futureTimestamp,
      signature,
      maxAge: 300,
    })

    expect(result).toBe(false)
  })

  it('should reject mismatched body', async () => {
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const signature = await generateSignature(signingSecret, timestamp, 'original-body')

    const result = await verifySignature({
      signingSecret,
      body: 'different-body',
      timestamp,
      signature,
    })

    expect(result).toBe(false)
  })
})

// =============================================================================
// SlashCommands Class Tests
// =============================================================================

describe('SlashCommands', () => {
  const signingSecret = 'test-secret-12345'
  const token = 'xoxb-test-token'

  describe('registration', () => {
    it('should register a command handler', () => {
      const commands = new SlashCommands({ signingSecret })
      const handler = vi.fn()

      commands.register('/deploy', handler)

      expect(commands.getCommands()).toHaveLength(1)
      expect(commands.getCommands()[0].name).toBe('/deploy')
    })

    it('should auto-prefix command with /', () => {
      const commands = new SlashCommands({ signingSecret })

      commands.register('deploy', vi.fn())

      expect(commands.getCommands()[0].name).toBe('/deploy')
    })

    it('should register subcommands', () => {
      const commands = new SlashCommands({ signingSecret })

      commands.register('/git', vi.fn())
      commands.subcommand('/git', 'commit', vi.fn())
      commands.subcommand('/git', 'push', vi.fn())

      const gitCmd = commands.getCommands().find((c) => c.name === '/git')
      expect(gitCmd?.subcommands?.size).toBe(2)
    })

    it('should throw when registering subcommand for non-existent parent', () => {
      const commands = new SlashCommands({ signingSecret })

      expect(() => {
        commands.subcommand('/unknown', 'sub', vi.fn())
      }).toThrow(SlashCommandError)
    })
  })

  describe('handleRequest', () => {
    it('should reject non-POST requests', async () => {
      const commands = new SlashCommands({ signingSecret })

      const response = await commands.handleRequest(
        new Request('https://example.com/commands', { method: 'GET' })
      )

      expect(response.status).toBe(405)
    })

    it('should reject missing signature headers', async () => {
      const commands = new SlashCommands({ signingSecret })

      const response = await commands.handleRequest(
        new Request('https://example.com/commands', {
          method: 'POST',
          body: 'command=/test',
        })
      )

      expect(response.status).toBe(401)
    })

    it('should reject invalid signature', async () => {
      const commands = new SlashCommands({ signingSecret })

      const response = await commands.handleRequest(
        new Request('https://example.com/commands', {
          method: 'POST',
          headers: {
            'x-slack-request-timestamp': Math.floor(Date.now() / 1000).toString(),
            'x-slack-signature': 'v0=invalid',
          },
          body: 'command=/test',
        })
      )

      expect(response.status).toBe(401)
    })

    it('should execute registered handler', async () => {
      const mockFetch = createMockFetch()
      const commands = new SlashCommands({
        signingSecret,
        token,
        fetch: mockFetch as any,
      })

      const handler = vi.fn(async ({ ack }: CommandContext) => {
        await ack('Hello!')
      })
      commands.register('/test', handler)

      const request = await createSignedRequest(signingSecret, defaultCommandPayload)
      const response = await commands.handleRequest(request)

      expect(handler).toHaveBeenCalled()
      expect(response.status).toBe(200)

      const body = await response.json()
      expect(body.text).toBe('Hello!')
    })

    it('should return empty response when ack not called with response', async () => {
      const mockFetch = createMockFetch()
      const commands = new SlashCommands({
        signingSecret,
        token,
        fetch: mockFetch as any,
      })

      commands.register('/test', async ({ ack }) => {
        await ack()
      })

      const request = await createSignedRequest(signingSecret, defaultCommandPayload)
      const response = await commands.handleRequest(request)

      expect(response.status).toBe(200)
      const text = await response.text()
      expect(text).toBe('')
    })

    it('should return error for unknown command', async () => {
      const commands = new SlashCommands({ signingSecret })

      const request = await createSignedRequest(signingSecret, {
        ...defaultCommandPayload,
        command: '/unknown',
      })
      const response = await commands.handleRequest(request)

      const body = await response.json()
      expect(body.text).toContain('Unknown command')
    })

    it('should handle errors gracefully', async () => {
      const commands = new SlashCommands({ signingSecret })

      commands.register('/test', async () => {
        throw new Error('Something went wrong')
      })

      const request = await createSignedRequest(signingSecret, defaultCommandPayload)
      const response = await commands.handleRequest(request)

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.text).toContain('Error')
    })
  })

  describe('command context', () => {
    it('should provide parsed arguments', async () => {
      const mockFetch = createMockFetch()
      const commands = new SlashCommands({
        signingSecret,
        token,
        fetch: mockFetch as any,
      })

      let capturedArgs: any
      commands.register('/deploy', async ({ args, ack }) => {
        capturedArgs = args
        await ack()
      })

      const request = await createSignedRequest(signingSecret, {
        ...defaultCommandPayload,
        command: '/deploy',
        text: 'production --force -v',
      })
      await commands.handleRequest(request)

      expect(capturedArgs.positional).toContain('production')
      expect(capturedArgs.flags.force).toBe(true)
      expect(capturedArgs.flags.v).toBe(true)
    })

    it('should prevent double ack', async () => {
      const commands = new SlashCommands({ signingSecret })

      let error: any
      commands.register('/test', async ({ ack }) => {
        await ack()
        try {
          await ack()
        } catch (e) {
          error = e
        }
      })

      const request = await createSignedRequest(signingSecret, defaultCommandPayload)
      await commands.handleRequest(request)

      expect(error).toBeInstanceOf(SlashCommandError)
      expect(error.code).toBe('already_acked')
    })

    it('should allow respond for delayed responses', async () => {
      const mockFetch = createMockFetch()
      const commands = new SlashCommands({
        signingSecret,
        token,
        fetch: mockFetch as any,
      })

      commands.register('/test', async ({ ack, respond }) => {
        await ack()
        await respond('Delayed response')
      })

      const request = await createSignedRequest(signingSecret, defaultCommandPayload)
      await commands.handleRequest(request)

      expect(mockFetch).toHaveBeenCalledWith(
        defaultCommandPayload.response_url,
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('Delayed response'),
        })
      )
    })

    it('should allow say for channel messages', async () => {
      const mockFetch = createMockFetch(
        new Map([['https://slack.com/api/chat.postMessage', { ok: true }]])
      )
      const commands = new SlashCommands({
        signingSecret,
        token,
        fetch: mockFetch as any,
      })

      commands.register('/test', async ({ ack, say }) => {
        await ack()
        await say('Hello channel!')
      })

      const request = await createSignedRequest(signingSecret, defaultCommandPayload)
      await commands.handleRequest(request)

      expect(mockFetch).toHaveBeenCalledWith(
        'https://slack.com/api/chat.postMessage',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('Hello channel!'),
        })
      )
    })

    it('should allow opening modals', async () => {
      const mockFetch = createMockFetch(
        new Map([['https://slack.com/api/views.open', { ok: true }]])
      )
      const commands = new SlashCommands({
        signingSecret,
        token,
        fetch: mockFetch as any,
      })

      commands.register('/test', async ({ ack, openModal }) => {
        await ack()
        await openModal({
          title: { type: 'plain_text', text: 'Test Modal' },
          blocks: [],
        })
      })

      const request = await createSignedRequest(signingSecret, defaultCommandPayload)
      await commands.handleRequest(request)

      expect(mockFetch).toHaveBeenCalledWith(
        'https://slack.com/api/views.open',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('Test Modal'),
        })
      )
    })
  })

  describe('subcommand handling', () => {
    it('should route to subcommand handler', async () => {
      const mockFetch = createMockFetch()
      const commands = new SlashCommands({
        signingSecret,
        token,
        fetch: mockFetch as any,
      })

      const mainHandler = vi.fn(async ({ ack }: CommandContext) => await ack('Main'))
      const subHandler = vi.fn(async ({ ack }: CommandContext) => await ack('Sub'))

      commands.register('/git', mainHandler)
      commands.subcommand('/git', 'commit', subHandler)

      const request = await createSignedRequest(signingSecret, {
        ...defaultCommandPayload,
        command: '/git',
        text: 'commit -m "test"',
      })
      await commands.handleRequest(request)

      expect(subHandler).toHaveBeenCalled()
      expect(mainHandler).not.toHaveBeenCalled()
    })

    it('should fall through to main handler when no subcommand matches', async () => {
      const mockFetch = createMockFetch()
      const commands = new SlashCommands({
        signingSecret,
        token,
        fetch: mockFetch as any,
      })

      const mainHandler = vi.fn(async ({ ack }: CommandContext) => await ack('Main'))

      commands.register('/git', mainHandler)
      commands.subcommand('/git', 'commit', vi.fn())

      const request = await createSignedRequest(signingSecret, {
        ...defaultCommandPayload,
        command: '/git',
        text: 'unknown-subcommand',
      })
      await commands.handleRequest(request)

      expect(mainHandler).toHaveBeenCalled()
    })
  })

  describe('help generation', () => {
    it('should generate help for all commands', () => {
      const commands = new SlashCommands({ signingSecret })

      commands.register('/deploy', vi.fn(), {
        description: 'Deploy applications',
      })
      commands.register('/status', vi.fn(), {
        description: 'Check status',
      })

      const help = commands.generateHelp()

      expect(help).toContain('/deploy')
      expect(help).toContain('/status')
      expect(help).toContain('Deploy applications')
      expect(help).toContain('Check status')
    })

    it('should generate help for specific command', () => {
      const commands = new SlashCommands({ signingSecret })

      commands.register('/deploy', vi.fn(), {
        description: 'Deploy applications',
        usage: '/deploy <env> [--force]',
        argConfig: {
          flags: {
            force: {
              alias: 'f',
              description: 'Force deployment',
            },
          },
        },
      })

      const help = commands.generateHelp('/deploy')

      expect(help).toContain('/deploy')
      expect(help).toContain('Deploy applications')
      expect(help).toContain('/deploy <env> [--force]')
      expect(help).toContain('--force')
      expect(help).toContain('-f')
      expect(help).toContain('Force deployment')
    })

    it('should list subcommands in help', () => {
      const commands = new SlashCommands({ signingSecret })

      commands.register('/git', vi.fn())
      commands.subcommand('/git', 'commit', vi.fn(), {
        description: 'Commit changes',
      })
      commands.subcommand('/git', 'push', vi.fn(), {
        description: 'Push to remote',
      })

      const help = commands.generateHelp('/git')

      expect(help).toContain('Subcommands')
      expect(help).toContain('commit')
      expect(help).toContain('push')
      expect(help).toContain('Commit changes')
      expect(help).toContain('Push to remote')
    })

    it('should return error for unknown command help', () => {
      const commands = new SlashCommands({ signingSecret })

      const help = commands.generateHelp('/unknown')

      expect(help).toContain('Unknown command')
    })
  })
})

// =============================================================================
// Response Helpers Tests
// =============================================================================

describe('response helpers', () => {
  describe('commandResponse', () => {
    it('should create response with all options', () => {
      const response = commandResponse({
        text: 'Hello',
        response_type: 'in_channel',
        replace_original: true,
      })

      expect(response).toEqual({
        text: 'Hello',
        response_type: 'in_channel',
        replace_original: true,
      })
    })
  })

  describe('ephemeral', () => {
    it('should create ephemeral response', () => {
      const response = ephemeral('Only you can see this')

      expect(response.text).toBe('Only you can see this')
      expect(response.response_type).toBe('ephemeral')
    })

    it('should include blocks', () => {
      const blocks = [{ type: 'section' as const, text: { type: 'mrkdwn' as const, text: 'Hello' } }]
      const response = ephemeral('Hello', blocks)

      expect(response.blocks).toBe(blocks)
    })
  })

  describe('inChannel', () => {
    it('should create in_channel response', () => {
      const response = inChannel('Everyone can see this')

      expect(response.text).toBe('Everyone can see this')
      expect(response.response_type).toBe('in_channel')
    })

    it('should include blocks', () => {
      const blocks = [{ type: 'section' as const, text: { type: 'mrkdwn' as const, text: 'Hello' } }]
      const response = inChannel('Hello', blocks)

      expect(response.blocks).toBe(blocks)
    })
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('SlashCommands integration', () => {
  const signingSecret = 'test-secret-12345'
  const token = 'xoxb-test-token'

  it('should handle full deploy command flow', async () => {
    const mockFetch = createMockFetch()
    const commands = new SlashCommands({
      signingSecret,
      token,
      fetch: mockFetch as any,
    })

    const deployments: string[] = []

    commands.register(
      '/deploy',
      async ({ args, ack, respond }) => {
        const env = args.positional[0] || 'staging'
        const force = args.flags.force === true

        await ack(`Starting deployment to ${env}...`)

        // Simulate deployment
        deployments.push(`${env}${force ? ' (forced)' : ''}`)

        await respond({
          text: `Successfully deployed to ${env}`,
          response_type: 'in_channel',
        })
      },
      {
        description: 'Deploy to environment',
        usage: '/deploy <env> [--force]',
        argConfig: {
          flags: {
            force: { alias: 'f' },
          },
        },
      }
    )

    // Test normal deployment
    const request1 = await createSignedRequest(signingSecret, {
      ...defaultCommandPayload,
      command: '/deploy',
      text: 'production',
    })
    const response1 = await commands.handleRequest(request1)

    expect(response1.status).toBe(200)
    expect(deployments).toContain('production')

    // Test forced deployment
    const request2 = await createSignedRequest(signingSecret, {
      ...defaultCommandPayload,
      command: '/deploy',
      text: 'staging --force',
    })
    await commands.handleRequest(request2)

    expect(deployments).toContain('staging (forced)')
  })

  it('should handle help command', async () => {
    const mockFetch = createMockFetch()
    const commands = new SlashCommands({
      signingSecret,
      token,
      fetch: mockFetch as any,
    })

    commands.register('/deploy', vi.fn(), { description: 'Deploy apps' })
    commands.register('/status', vi.fn(), { description: 'Check status' })
    commands.register(
      '/help',
      async ({ args, ack }) => {
        const help = commands.generateHelp(args.positional[0])
        await ack({
          text: help,
          response_type: 'ephemeral',
        })
      },
      { description: 'Show help' }
    )

    const request = await createSignedRequest(signingSecret, {
      ...defaultCommandPayload,
      command: '/help',
      text: '',
    })
    const response = await commands.handleRequest(request)

    const body = await response.json()
    expect(body.text).toContain('/deploy')
    expect(body.text).toContain('/status')
    expect(body.text).toContain('/help')
  })
})

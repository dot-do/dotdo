/**
 * @dotdo/slack - Slash Commands Handler
 *
 * Complete slash command handling with signature verification, argument parsing,
 * immediate and delayed responses, and modal triggers.
 *
 * @example Basic Handler
 * ```typescript
 * import { SlashCommands } from '@dotdo/slack/slash-commands'
 *
 * const commands = new SlashCommands({
 *   signingSecret: 'your-signing-secret',
 *   token: 'xoxb-token',
 * })
 *
 * // Register a command
 * commands.register('/deploy', async ({ command, ack, respond }) => {
 *   await ack('Starting deployment...')
 *   // Long-running operation
 *   const result = await deploy(command.text)
 *   await respond({ text: `Deployed: ${result}` })
 * })
 *
 * // In your worker
 * export default {
 *   fetch: commands.handleRequest.bind(commands),
 * }
 * ```
 *
 * @example Argument Parsing
 * ```typescript
 * commands.register('/remind', async ({ command, args, ack, respond }) => {
 *   const { positional, flags } = args
 *   // /remind @user in 1 hour --silent
 *   // positional: ['@user', 'in', '1', 'hour']
 *   // flags: { silent: true }
 *   await ack()
 *   await respond({ text: `Reminder set for ${positional[0]}` })
 * })
 * ```
 *
 * @example Modal Triggers
 * ```typescript
 * commands.register('/feedback', async ({ command, ack, openModal }) => {
 *   await ack()
 *   await openModal({
 *     title: plainText('Submit Feedback'),
 *     callback_id: 'feedback_modal',
 *     blocks: new Blocks()
 *       .input({
 *         label: plainText('Your feedback'),
 *         element: textInput({ action_id: 'feedback_input', multiline: true }),
 *       })
 *       .build(),
 *   })
 * })
 * ```
 *
 * @module @dotdo/slack/slash-commands
 */

import type {
  SlashCommand,
  CommandResponse,
  ViewOutput,
  Block,
} from './types'
import { WebClient } from './client'
import type { ModalView } from './blocks'

// =============================================================================
// Types
// =============================================================================

/**
 * Parsed command arguments
 */
export interface ParsedArgs {
  /** Raw text after the command */
  raw: string
  /** Positional arguments (non-flag tokens) */
  positional: string[]
  /** Named flags (--flag or --key=value) */
  flags: Record<string, string | boolean>
  /** Subcommand if configured */
  subcommand?: string
  /** Remaining text after subcommand */
  rest?: string
}

/**
 * Command handler context
 */
export interface CommandContext {
  /** The raw slash command payload */
  command: SlashCommand
  /** Parsed arguments */
  args: ParsedArgs
  /** WebClient instance for API calls */
  client: WebClient
  /**
   * Acknowledge the command (must be called within 3 seconds)
   * Can optionally include an immediate response
   */
  ack: (response?: string | CommandResponse) => Promise<void>
  /**
   * Send a delayed response using response_url (up to 30 minutes)
   * Use this for responses that take longer than 3 seconds
   */
  respond: (message: string | CommandResponse) => Promise<void>
  /**
   * Post a message to the channel using chat.postMessage
   */
  say: (message: string | { text?: string; blocks?: Block[] }) => Promise<void>
  /**
   * Open a modal using the trigger_id
   * Must be called within 3 seconds of receiving the command
   */
  openModal: (view: Omit<ModalView, 'type'>) => Promise<void>
  /**
   * Update an existing modal
   */
  updateModal: (viewId: string, view: Omit<ModalView, 'type'>) => Promise<void>
  /**
   * Push a new view onto the modal stack
   */
  pushModal: (view: Omit<ModalView, 'type'>) => Promise<void>
}

/**
 * Command handler function
 */
export type CommandHandler = (ctx: CommandContext) => Promise<void>

/**
 * Command definition
 */
export interface CommandDefinition {
  /** Command name (e.g., '/deploy') */
  name: string
  /** Description for help */
  description?: string
  /** Usage example */
  usage?: string
  /** Handler function */
  handler: CommandHandler
  /** Subcommands */
  subcommands?: Map<string, CommandDefinition>
  /** Argument configuration */
  argConfig?: ArgConfig
}

/**
 * Argument configuration
 */
export interface ArgConfig {
  /** Named flags that should be parsed */
  flags?: {
    [key: string]: {
      /** Short alias (e.g., 'v' for --verbose) */
      alias?: string
      /** Whether the flag takes a value */
      hasValue?: boolean
      /** Default value */
      default?: string | boolean
      /** Description for help */
      description?: string
    }
  }
  /** Expected positional arguments */
  positional?: {
    name: string
    required?: boolean
    description?: string
  }[]
}

/**
 * SlashCommands configuration options
 */
export interface SlashCommandsOptions {
  /** Slack signing secret for request verification */
  signingSecret: string
  /** Bot token for API calls */
  token?: string
  /** Maximum age for signature verification (default: 300 seconds) */
  maxSignatureAge?: number
  /** Custom fetch implementation */
  fetch?: typeof fetch
  /** Base URL for Slack API (default: https://slack.com) */
  baseUrl?: string
}

/**
 * Delayed response options
 */
export interface DelayedResponseOptions {
  /** Replace the original message (default: false) */
  replace_original?: boolean
  /** Delete the original message */
  delete_original?: boolean
  /** Response visibility: 'ephemeral' (only user) or 'in_channel' (visible to all) */
  response_type?: 'ephemeral' | 'in_channel'
}

// =============================================================================
// Slash Commands Error
// =============================================================================

/**
 * Error thrown by slash command operations
 */
export class SlashCommandError extends Error {
  code: string
  statusCode?: number
  details?: unknown

  constructor(code: string, message: string, statusCode?: number, details?: unknown) {
    super(message)
    this.name = 'SlashCommandError'
    this.code = code
    this.statusCode = statusCode
    this.details = details
  }
}

// =============================================================================
// Argument Parser
// =============================================================================

/**
 * Parse command arguments from text
 */
export function parseArgs(text: string, config?: ArgConfig): ParsedArgs {
  const result: ParsedArgs = {
    raw: text,
    positional: [],
    flags: {},
  }

  // Initialize defaults from config FIRST (before checking for empty text)
  if (config?.flags) {
    for (const [key, flagConfig] of Object.entries(config.flags)) {
      if (flagConfig.default !== undefined) {
        result.flags[key] = flagConfig.default
      }
    }
  }

  if (!text.trim()) {
    return result
  }

  // Tokenize while respecting quotes
  const tokens = tokenize(text)

  let i = 0
  while (i < tokens.length) {
    const token = tokens[i]

    // Handle long flags (--flag or --flag=value)
    if (token.startsWith('--')) {
      const [key, ...valueParts] = token.slice(2).split('=')
      const flagConfig = config?.flags?.[key]

      if (valueParts.length > 0) {
        // --flag=value
        result.flags[key] = valueParts.join('=')
      } else if (flagConfig?.hasValue && i + 1 < tokens.length && !tokens[i + 1].startsWith('-')) {
        // --flag value (next token is value)
        result.flags[key] = tokens[++i]
      } else {
        // Boolean flag
        result.flags[key] = true
      }
    }
    // Handle short flags (-f or -f value)
    else if (token.startsWith('-') && token.length === 2) {
      const alias = token[1]
      // Find the full flag name from alias, also check if the short flag itself is configured
      let flagName = alias
      let flagConfig: ArgConfig['flags'][string] | undefined

      if (config?.flags) {
        // First check if this is configured directly as a flag name
        if (config.flags[alias]) {
          flagName = alias
          flagConfig = config.flags[alias]
        } else {
          // Then check aliases
          for (const [key, cfg] of Object.entries(config.flags)) {
            if (cfg.alias === alias) {
              flagName = key
              flagConfig = cfg
              break
            }
          }
        }
      }

      if (flagConfig?.hasValue && i + 1 < tokens.length && !tokens[i + 1].startsWith('-')) {
        result.flags[flagName] = tokens[++i]
      } else {
        result.flags[flagName] = true
      }
    }
    // Handle combined short flags (-abc = -a -b -c)
    else if (token.startsWith('-') && token.length > 2 && !token.startsWith('--')) {
      for (const char of token.slice(1)) {
        let flagName = char
        if (config?.flags) {
          // Check if this is configured directly as a flag name
          if (config.flags[char]) {
            flagName = char
          } else {
            // Then check aliases
            for (const [key, cfg] of Object.entries(config.flags)) {
              if (cfg.alias === char) {
                flagName = key
                break
              }
            }
          }
        }
        result.flags[flagName] = true
      }
    }
    // Positional argument
    else {
      result.positional.push(token)
    }

    i++
  }

  // Extract subcommand if first positional looks like one
  if (result.positional.length > 0 && !result.positional[0].startsWith('@') && !result.positional[0].startsWith('<')) {
    const potentialSubcommand = result.positional[0].toLowerCase()
    // Only treat as subcommand if it looks like a word (not a user mention, channel, etc.)
    if (/^[a-z][a-z0-9_-]*$/i.test(potentialSubcommand)) {
      result.subcommand = potentialSubcommand
      result.rest = result.positional.slice(1).join(' ')
    }
  }

  return result
}

/**
 * Tokenize a string respecting quoted sections
 */
function tokenize(text: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inQuote: '"' | "'" | null = null
  let escape = false

  for (const char of text) {
    if (escape) {
      current += char
      escape = false
      continue
    }

    if (char === '\\') {
      escape = true
      continue
    }

    if ((char === '"' || char === "'") && !inQuote) {
      inQuote = char
      continue
    }

    if (char === inQuote) {
      inQuote = null
      continue
    }

    if (char === ' ' && !inQuote) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }

    current += char
  }

  if (current) {
    tokens.push(current)
  }

  return tokens
}

// =============================================================================
// Signature Verification
// =============================================================================

/**
 * Generate HMAC-SHA256 signature
 */
async function generateSignature(
  signingSecret: string,
  timestamp: string,
  body: string
): Promise<string> {
  const baseString = `v0:${timestamp}:${body}`
  const encoder = new TextEncoder()
  const keyData = encoder.encode(signingSecret)
  const messageData = encoder.encode(baseString)

  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const signature = await crypto.subtle.sign('HMAC', key, messageData)
  const hexSignature = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  return `v0=${hexSignature}`
}

/**
 * Verify Slack request signature
 */
export async function verifySignature(options: {
  signingSecret: string
  body: string
  timestamp: string
  signature: string
  maxAge?: number
}): Promise<boolean> {
  const { signingSecret, body, timestamp, signature, maxAge = 300 } = options

  // Check timestamp is not too old (replay attack protection)
  const now = Math.floor(Date.now() / 1000)
  const requestTime = parseInt(timestamp, 10)
  if (isNaN(requestTime) || Math.abs(now - requestTime) > maxAge) {
    return false
  }

  // Generate expected signature
  const expectedSignature = await generateSignature(signingSecret, timestamp, body)

  // Constant-time comparison to prevent timing attacks
  if (signature.length !== expectedSignature.length) {
    return false
  }

  let result = 0
  for (let i = 0; i < signature.length; i++) {
    result |= signature.charCodeAt(i) ^ expectedSignature.charCodeAt(i)
  }

  return result === 0
}

// =============================================================================
// Response URL Client
// =============================================================================

/**
 * Send a delayed response using response_url
 */
async function sendDelayedResponse(
  responseUrl: string,
  message: string | CommandResponse,
  options?: DelayedResponseOptions,
  fetchFn: typeof fetch = fetch
): Promise<void> {
  const body: CommandResponse = typeof message === 'string' ? { text: message } : { ...message }

  if (options?.replace_original !== undefined) {
    body.replace_original = options.replace_original
  }
  if (options?.delete_original !== undefined) {
    body.delete_original = options.delete_original
  }
  if (options?.response_type !== undefined) {
    body.response_type = options.response_type
  }

  const response = await fetchFn(responseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new SlashCommandError(
      'response_url_error',
      `Failed to send delayed response: ${response.status} ${text}`,
      response.status
    )
  }
}

// =============================================================================
// Slash Commands Handler
// =============================================================================

/**
 * Slash Commands handler for Cloudflare Workers
 */
export class SlashCommands {
  private signingSecret: string
  private token?: string
  private maxSignatureAge: number
  private _fetch: typeof fetch
  private baseUrl: string
  private commands: Map<string, CommandDefinition> = new Map()
  private client: WebClient

  constructor(options: SlashCommandsOptions) {
    this.signingSecret = options.signingSecret
    this.token = options.token
    this.maxSignatureAge = options.maxSignatureAge ?? 300
    this._fetch = options.fetch ?? globalThis.fetch?.bind(globalThis)
    this.baseUrl = options.baseUrl ?? 'https://slack.com'
    this.client = new WebClient(this.token, {
      fetch: this._fetch,
      slackApiUrl: `${this.baseUrl}/api`,
    })
  }

  /**
   * Register a slash command handler
   */
  register(
    command: string,
    handler: CommandHandler,
    options?: { description?: string; usage?: string; argConfig?: ArgConfig }
  ): this {
    // Ensure command starts with /
    const name = command.startsWith('/') ? command : `/${command}`

    this.commands.set(name, {
      name,
      handler,
      description: options?.description,
      usage: options?.usage,
      argConfig: options?.argConfig,
    })

    return this
  }

  /**
   * Register a subcommand for an existing command
   */
  subcommand(
    parent: string,
    subcommand: string,
    handler: CommandHandler,
    options?: { description?: string; usage?: string; argConfig?: ArgConfig }
  ): this {
    const parentName = parent.startsWith('/') ? parent : `/${parent}`
    const parentCmd = this.commands.get(parentName)

    if (!parentCmd) {
      throw new SlashCommandError(
        'parent_not_found',
        `Parent command ${parentName} not found. Register the parent command first.`
      )
    }

    if (!parentCmd.subcommands) {
      parentCmd.subcommands = new Map()
    }

    parentCmd.subcommands.set(subcommand, {
      name: subcommand,
      handler,
      description: options?.description,
      usage: options?.usage,
      argConfig: options?.argConfig,
    })

    return this
  }

  /**
   * Handle an incoming HTTP request
   */
  async handleRequest(request: Request): Promise<Response> {
    // Only accept POST requests
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }

    // Get raw body for signature verification
    const rawBody = await request.text()

    // Verify signature
    const timestamp = request.headers.get('x-slack-request-timestamp')
    const signature = request.headers.get('x-slack-signature')

    if (!timestamp || !signature) {
      return new Response('Missing signature headers', { status: 401 })
    }

    const isValid = await verifySignature({
      signingSecret: this.signingSecret,
      body: rawBody,
      timestamp,
      signature,
      maxAge: this.maxSignatureAge,
    })

    if (!isValid) {
      return new Response('Invalid signature', { status: 401 })
    }

    // Parse form data
    const params = new URLSearchParams(rawBody)
    const command = this.parseSlashCommand(params)

    // Find and execute handler
    return this.executeCommand(command)
  }

  /**
   * Parse URLSearchParams into SlashCommand
   */
  private parseSlashCommand(params: URLSearchParams): SlashCommand {
    return {
      command: params.get('command') || '',
      text: params.get('text') || '',
      response_url: params.get('response_url') || '',
      trigger_id: params.get('trigger_id') || '',
      user_id: params.get('user_id') || '',
      user_name: params.get('user_name') || '',
      team_id: params.get('team_id') || '',
      team_domain: params.get('team_domain') || undefined,
      channel_id: params.get('channel_id') || '',
      channel_name: params.get('channel_name') || '',
      enterprise_id: params.get('enterprise_id') || undefined,
      enterprise_name: params.get('enterprise_name') || undefined,
      api_app_id: params.get('api_app_id') || undefined,
      is_enterprise_install: params.get('is_enterprise_install') || undefined,
    }
  }

  /**
   * Execute a command handler
   */
  private async executeCommand(command: SlashCommand): Promise<Response> {
    const definition = this.commands.get(command.command)

    if (!definition) {
      return new Response(
        JSON.stringify({
          response_type: 'ephemeral',
          text: `Unknown command: ${command.command}`,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    // Parse arguments
    const args = parseArgs(command.text, definition.argConfig)

    // Check for subcommand
    let handler = definition.handler
    let argConfig = definition.argConfig

    if (args.subcommand && definition.subcommands?.has(args.subcommand)) {
      const subDef = definition.subcommands.get(args.subcommand)!
      handler = subDef.handler
      argConfig = subDef.argConfig

      // Re-parse args with subcommand's config if different
      if (argConfig !== definition.argConfig) {
        const subArgs = parseArgs(args.rest || '', argConfig)
        args.positional = subArgs.positional
        args.flags = { ...args.flags, ...subArgs.flags }
        args.raw = args.rest || ''
      }
    }

    // Track ack state
    let acked = false
    let ackResponse: string | CommandResponse | undefined

    // Create context
    const ctx: CommandContext = {
      command,
      args,
      client: this.client,

      ack: async (response) => {
        if (acked) {
          throw new SlashCommandError('already_acked', 'Command has already been acknowledged')
        }
        acked = true
        ackResponse = response
      },

      respond: async (message) => {
        await sendDelayedResponse(command.response_url, message, undefined, this._fetch)
      },

      say: async (message) => {
        const payload = typeof message === 'string' ? { text: message } : message
        await this.client.chat.postMessage({
          channel: command.channel_id,
          ...payload,
        } as Parameters<typeof this.client.chat.postMessage>[0])
      },

      openModal: async (view) => {
        await this.openView(command.trigger_id, { type: 'modal', ...view })
      },

      updateModal: async (viewId, view) => {
        await this.updateView(viewId, { type: 'modal', ...view })
      },

      pushModal: async (view) => {
        await this.pushView(command.trigger_id, { type: 'modal', ...view })
      },
    }

    // Execute handler
    try {
      await handler(ctx)

      // If handler didn't explicitly ack, return empty 200
      if (!acked) {
        return new Response('', { status: 200 })
      }

      // Return ack response
      if (ackResponse === undefined) {
        return new Response('', { status: 200 })
      }

      const responseBody =
        typeof ackResponse === 'string' ? { text: ackResponse } : ackResponse

      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (error) {
      console.error('Command handler error:', error)

      // Return error message to user
      return new Response(
        JSON.stringify({
          response_type: 'ephemeral',
          text: `Error executing command: ${error instanceof Error ? error.message : 'Unknown error'}`,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }
  }

  /**
   * Open a modal view
   */
  private async openView(triggerId: string, view: ModalView): Promise<void> {
    const response = await this._fetch(`${this.baseUrl}/api/views.open`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        trigger_id: triggerId,
        view,
      }),
    })

    const data = await response.json() as { ok: boolean; error?: string }

    if (!data.ok) {
      throw new SlashCommandError('views_open_error', `Failed to open modal: ${data.error}`)
    }
  }

  /**
   * Update a modal view
   */
  private async updateView(viewId: string, view: ModalView): Promise<void> {
    const response = await this._fetch(`${this.baseUrl}/api/views.update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        view_id: viewId,
        view,
      }),
    })

    const data = await response.json() as { ok: boolean; error?: string }

    if (!data.ok) {
      throw new SlashCommandError('views_update_error', `Failed to update modal: ${data.error}`)
    }
  }

  /**
   * Push a new view onto the modal stack
   */
  private async pushView(triggerId: string, view: ModalView): Promise<void> {
    const response = await this._fetch(`${this.baseUrl}/api/views.push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        trigger_id: triggerId,
        view,
      }),
    })

    const data = await response.json() as { ok: boolean; error?: string }

    if (!data.ok) {
      throw new SlashCommandError('views_push_error', `Failed to push modal: ${data.error}`)
    }
  }

  /**
   * Get registered commands for help generation
   */
  getCommands(): CommandDefinition[] {
    return Array.from(this.commands.values())
  }

  /**
   * Generate help text for a command
   */
  generateHelp(commandName?: string): string {
    if (commandName) {
      const name = commandName.startsWith('/') ? commandName : `/${commandName}`
      const cmd = this.commands.get(name)

      if (!cmd) {
        return `Unknown command: ${name}`
      }

      let help = `*${cmd.name}*`
      if (cmd.description) help += `\n${cmd.description}`
      if (cmd.usage) help += `\n\nUsage: \`${cmd.usage}\``

      if (cmd.subcommands && cmd.subcommands.size > 0) {
        help += '\n\n*Subcommands:*'
        for (const [subName, subCmd] of Array.from(cmd.subcommands.entries())) {
          help += `\n  \`${subName}\``
          if (subCmd.description) help += ` - ${subCmd.description}`
        }
      }

      if (cmd.argConfig?.flags) {
        help += '\n\n*Flags:*'
        for (const [flag, config] of Object.entries(cmd.argConfig.flags)) {
          let flagStr = `  \`--${flag}\``
          if (config.alias) flagStr += ` (\`-${config.alias}\`)`
          if (config.description) flagStr += ` - ${config.description}`
          help += '\n' + flagStr
        }
      }

      return help
    }

    // Generate help for all commands
    let help = '*Available Commands:*\n'
    for (const cmd of Array.from(this.commands.values())) {
      help += `\n\`${cmd.name}\``
      if (cmd.description) help += ` - ${cmd.description}`
    }

    return help
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Create a slash command response
 */
export function commandResponse(options: {
  text?: string
  blocks?: Block[]
  response_type?: 'ephemeral' | 'in_channel'
  replace_original?: boolean
  delete_original?: boolean
}): CommandResponse {
  return options
}

/**
 * Create an ephemeral response (only visible to the user who triggered the command)
 */
export function ephemeral(text: string, blocks?: Block[]): CommandResponse {
  return {
    text,
    blocks,
    response_type: 'ephemeral',
  }
}

/**
 * Create an in_channel response (visible to everyone in the channel)
 */
export function inChannel(text: string, blocks?: Block[]): CommandResponse {
  return {
    text,
    blocks,
    response_type: 'in_channel',
  }
}

// =============================================================================
// Exports
// =============================================================================

export default SlashCommands

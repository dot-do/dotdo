/**
 * @dotdo/discord - Interactions
 *
 * Slash command handling and interaction responses for Discord
 *
 * @example
 * ```typescript
 * import {
 *   SlashCommandBuilder,
 *   InteractionResponseBuilder,
 *   InteractionType,
 *   InteractionResponseType,
 *   verifyInteraction
 * } from '@dotdo/discord/interactions'
 *
 * // Build slash commands
 * const pingCommand = new SlashCommandBuilder()
 *   .setName('ping')
 *   .setDescription('Check bot latency')
 *
 * // Handle interactions
 * export async function handleInteraction(req: Request, publicKey: string) {
 *   // Verify the interaction signature
 *   if (!await verifyInteraction(req, publicKey)) {
 *     return new Response('Invalid signature', { status: 401 })
 *   }
 *
 *   const interaction = await req.json()
 *
 *   // Handle ping (required for Discord)
 *   if (interaction.type === InteractionType.Ping) {
 *     return Response.json({ type: InteractionResponseType.Pong })
 *   }
 *
 *   // Handle slash commands
 *   if (interaction.type === InteractionType.ApplicationCommand) {
 *     const response = new InteractionResponseBuilder()
 *       .setContent('Pong!')
 *       .setEphemeral()
 *
 *     return Response.json({
 *       type: InteractionResponseType.ChannelMessageWithSource,
 *       data: response.toJSON()
 *     })
 *   }
 * }
 * ```
 *
 * @module @dotdo/discord/interactions
 */

import type { Embed, Component, User, GuildMember } from './types'
import { InteractionType, InteractionResponseType, ApplicationCommandOptionType } from './types'

// Re-export builders
export {
  SlashCommandBuilder,
  SlashCommandSubcommandBuilder,
  SlashCommandSubcommandGroupBuilder,
  SlashCommandStringOption,
  SlashCommandIntegerOption,
  SlashCommandNumberOption,
  SlashCommandBooleanOption,
  SlashCommandUserOption,
  SlashCommandChannelOption,
  SlashCommandRoleOption,
  SlashCommandMentionableOption,
  SlashCommandAttachmentOption,
  ActionRowBuilder,
  ButtonBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  ModalBuilder,
} from './builders'

// Re-export types
export {
  InteractionType,
  InteractionResponseType,
  ApplicationCommandOptionType,
  ButtonStyle,
  TextInputStyle,
  ComponentType,
} from './types'

export type {
  Interaction,
  InteractionData,
  CommandInteraction,
  ButtonInteraction,
  SelectMenuInteraction,
  ModalSubmitInteraction,
  ApplicationCommandInteractionDataOption,
  ResolvedData,
} from './types'

// ============================================================================
// INTERACTION RESPONSE BUILDER
// ============================================================================

/**
 * Interaction response data
 */
export interface InteractionResponseData {
  content?: string
  embeds?: Embed[]
  components?: Component[]
  flags?: number
  tts?: boolean
  allowed_mentions?: {
    parse?: ('roles' | 'users' | 'everyone')[]
    roles?: string[]
    users?: string[]
    replied_user?: boolean
  }
}

/**
 * Modal response data
 */
export interface ModalResponseData {
  custom_id: string
  title: string
  components: Component[]
}

/**
 * Autocomplete choice
 */
export interface AutocompleteChoice {
  name: string
  value: string | number
  name_localizations?: Record<string, string>
}

/**
 * Builder for interaction responses
 *
 * @example
 * ```typescript
 * const response = new InteractionResponseBuilder()
 *   .setContent('Hello!')
 *   .setEphemeral()
 *   .addEmbeds(embed.toJSON())
 *
 * return Response.json({
 *   type: InteractionResponseType.ChannelMessageWithSource,
 *   data: response.toJSON()
 * })
 * ```
 */
export class InteractionResponseBuilder {
  private data: InteractionResponseData = {}

  /**
   * Set the response content
   */
  setContent(content: string): this {
    this.data.content = content
    return this
  }

  /**
   * Set the response embeds
   */
  setEmbeds(embeds: Embed[]): this {
    this.data.embeds = embeds
    return this
  }

  /**
   * Add embeds to the response
   */
  addEmbeds(...embeds: Embed[]): this {
    if (!this.data.embeds) {
      this.data.embeds = []
    }
    this.data.embeds.push(...embeds)
    return this
  }

  /**
   * Set the response components
   */
  setComponents(components: Component[]): this {
    this.data.components = components
    return this
  }

  /**
   * Add components to the response
   */
  addComponents(...components: Component[]): this {
    if (!this.data.components) {
      this.data.components = []
    }
    this.data.components.push(...components)
    return this
  }

  /**
   * Set response flags
   */
  setFlags(flags: number): this {
    this.data.flags = flags
    return this
  }

  /**
   * Make the response ephemeral (only visible to the user)
   */
  setEphemeral(ephemeral = true): this {
    if (ephemeral) {
      this.data.flags = (this.data.flags ?? 0) | 64 // EPHEMERAL flag
    } else {
      this.data.flags = (this.data.flags ?? 0) & ~64
    }
    return this
  }

  /**
   * Set TTS for the response
   */
  setTTS(tts: boolean): this {
    this.data.tts = tts
    return this
  }

  /**
   * Set allowed mentions
   */
  setAllowedMentions(allowedMentions: InteractionResponseData['allowed_mentions']): this {
    this.data.allowed_mentions = allowedMentions
    return this
  }

  /**
   * Convert to JSON for API response
   */
  toJSON(): InteractionResponseData {
    return { ...this.data }
  }
}

// ============================================================================
// INTERACTION HELPERS
// ============================================================================

/**
 * Verify Discord interaction signature
 * Use this in your webhook handler to validate incoming interactions
 *
 * @example
 * ```typescript
 * export async function handleRequest(req: Request) {
 *   const isValid = await verifyInteraction(req, process.env.DISCORD_PUBLIC_KEY!)
 *   if (!isValid) {
 *     return new Response('Invalid signature', { status: 401 })
 *   }
 *   // Handle the interaction...
 * }
 * ```
 */
export async function verifyInteraction(
  request: Request,
  publicKey: string
): Promise<boolean> {
  const signature = request.headers.get('X-Signature-Ed25519')
  const timestamp = request.headers.get('X-Signature-Timestamp')

  if (!signature || !timestamp) {
    return false
  }

  // Clone the request to read the body
  const body = await request.clone().text()

  // Verify the signature using SubtleCrypto
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      hexToUint8Array(publicKey),
      { name: 'Ed25519', namedCurve: 'Ed25519' },
      false,
      ['verify']
    )

    const isValid = await crypto.subtle.verify(
      'Ed25519',
      key,
      hexToUint8Array(signature),
      new TextEncoder().encode(timestamp + body)
    )

    return isValid
  } catch {
    return false
  }
}

/**
 * Convert hex string to Uint8Array
 */
function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

/**
 * Check if interaction is a slash command
 */
export function isSlashCommand(interaction: { type: number }): boolean {
  return interaction.type === InteractionType.ApplicationCommand
}

/**
 * Check if interaction is a button click
 */
export function isButtonInteraction(interaction: {
  type: number
  data?: { component_type?: number }
}): boolean {
  return interaction.type === InteractionType.MessageComponent && interaction.data?.component_type === 2
}

/**
 * Check if interaction is a select menu
 */
export function isSelectMenuInteraction(interaction: {
  type: number
  data?: { component_type?: number }
}): boolean {
  return (
    interaction.type === InteractionType.MessageComponent &&
    interaction.data?.component_type !== undefined &&
    interaction.data.component_type >= 3 &&
    interaction.data.component_type <= 8
  )
}

/**
 * Check if interaction is a modal submit
 */
export function isModalSubmit(interaction: { type: number }): boolean {
  return interaction.type === InteractionType.ModalSubmit
}

/**
 * Check if interaction is an autocomplete request
 */
export function isAutocomplete(interaction: { type: number }): boolean {
  return interaction.type === InteractionType.ApplicationCommandAutocomplete
}

/**
 * Get an option value from interaction data
 */
export function getOption<T = string | number | boolean>(
  interaction: { data?: { options?: { name: string; value?: unknown; options?: unknown[] }[] } },
  name: string,
  subcommand?: string
): T | undefined {
  let options = interaction.data?.options

  // Navigate into subcommand if specified
  if (subcommand && options) {
    const sub = options.find(o => o.name === subcommand)
    options = sub?.options as typeof options
  }

  return options?.find(o => o.name === name)?.value as T | undefined
}

/**
 * Get all option values from interaction data
 */
export function getOptions(
  interaction: { data?: { options?: { name: string; value?: unknown }[] } },
  subcommand?: string
): Record<string, unknown> {
  let options = interaction.data?.options

  // Navigate into subcommand if specified
  if (subcommand && options) {
    const sub = options.find((o: any) => o.name === subcommand)
    options = (sub as any)?.options
  }

  const result: Record<string, unknown> = {}
  if (options) {
    for (const option of options) {
      if (option.value !== undefined) {
        result[option.name] = option.value
      }
    }
  }

  return result
}

/**
 * Get the subcommand name from interaction data
 */
export function getSubcommand(
  interaction: { data?: { options?: { name: string; type: number }[] } }
): string | undefined {
  return interaction.data?.options?.find(
    o => o.type === ApplicationCommandOptionType.SubCommand
  )?.name
}

/**
 * Get the subcommand group name from interaction data
 */
export function getSubcommandGroup(
  interaction: { data?: { options?: { name: string; type: number }[] } }
): string | undefined {
  return interaction.data?.options?.find(
    o => o.type === ApplicationCommandOptionType.SubCommandGroup
  )?.name
}

/**
 * Get the user who triggered the interaction
 */
export function getInteractionUser(
  interaction: { user?: User; member?: GuildMember }
): User | undefined {
  return interaction.user ?? interaction.member?.user
}

/**
 * Get selected values from a select menu interaction
 */
export function getSelectedValues(
  interaction: { data?: { values?: string[] } }
): string[] {
  return interaction.data?.values ?? []
}

/**
 * Get modal field values
 */
export function getModalValues(
  interaction: { data?: { components?: { components?: { custom_id?: string; value?: string }[] }[] } }
): Record<string, string> {
  const result: Record<string, string> = {}

  if (interaction.data?.components) {
    for (const row of interaction.data.components) {
      if (row.components) {
        for (const component of row.components) {
          if (component.custom_id && component.value !== undefined) {
            result[component.custom_id] = component.value
          }
        }
      }
    }
  }

  return result
}

// ============================================================================
// RESPONSE FACTORIES
// ============================================================================

/**
 * Create a pong response (for Discord's ping verification)
 */
export function createPongResponse() {
  return { type: InteractionResponseType.Pong }
}

/**
 * Create a message response
 */
export function createMessageResponse(
  data: InteractionResponseData | string
): { type: number; data: InteractionResponseData } {
  const responseData = typeof data === 'string' ? { content: data } : data
  return {
    type: InteractionResponseType.ChannelMessageWithSource,
    data: responseData,
  }
}

/**
 * Create a deferred response (shows "Bot is thinking...")
 */
export function createDeferredResponse(
  ephemeral = false
): { type: number; data?: { flags: number } } {
  return {
    type: InteractionResponseType.DeferredChannelMessageWithSource,
    ...(ephemeral && { data: { flags: 64 } }),
  }
}

/**
 * Create a deferred update response (for components, doesn't show thinking)
 */
export function createDeferredUpdateResponse(): { type: number } {
  return { type: InteractionResponseType.DeferredUpdateMessage }
}

/**
 * Create an update message response (for components)
 */
export function createUpdateResponse(
  data: InteractionResponseData | string
): { type: number; data: InteractionResponseData } {
  const responseData = typeof data === 'string' ? { content: data } : data
  return {
    type: InteractionResponseType.UpdateMessage,
    data: responseData,
  }
}

/**
 * Create a modal response
 */
export function createModalResponse(
  modal: ModalResponseData
): { type: number; data: ModalResponseData } {
  return {
    type: InteractionResponseType.Modal,
    data: modal,
  }
}

/**
 * Create an autocomplete response
 */
export function createAutocompleteResponse(
  choices: AutocompleteChoice[]
): { type: number; data: { choices: AutocompleteChoice[] } } {
  return {
    type: InteractionResponseType.ApplicationCommandAutocompleteResult,
    data: { choices },
  }
}

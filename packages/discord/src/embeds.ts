/**
 * @dotdo/discord - Embeds
 *
 * Rich embed builder for Discord messages
 *
 * @example
 * ```typescript
 * import { EmbedBuilder, EmbedColors } from '@dotdo/discord/embeds'
 *
 * const embed = new EmbedBuilder()
 *   .setTitle('Welcome!')
 *   .setDescription('Thanks for joining our server.')
 *   .setColor(EmbedColors.Green)
 *   .setThumbnail('https://example.com/avatar.png')
 *   .setFooter({ text: 'Powered by dotdo' })
 *   .setTimestamp()
 *   .addFields(
 *     { name: 'Members', value: '1,234', inline: true },
 *     { name: 'Online', value: '456', inline: true }
 *   )
 *
 * await rest.post(Routes.channelMessages(channelId), {
 *   body: { embeds: [embed.toJSON()] }
 * })
 * ```
 *
 * @module @dotdo/discord/embeds
 */

// Re-export the EmbedBuilder from builders
import { EmbedBuilder } from './builders'
export { EmbedBuilder }

// Re-export embed types from types
export type {
  Embed,
  EmbedField,
  EmbedFooter,
  EmbedAuthor,
  EmbedImage,
  EmbedThumbnail,
  EmbedVideo,
  EmbedProvider,
} from './types'

// ============================================================================
// EMBED COLORS
// ============================================================================

/**
 * Common embed colors
 */
export const EmbedColors = {
  // Brand colors
  Default: 0x000000,
  White: 0xffffff,
  Aqua: 0x1abc9c,
  Green: 0x57f287,
  Blue: 0x3498db,
  Yellow: 0xfee75c,
  Purple: 0x9b59b6,
  LuminousVividPink: 0xe91e63,
  Fuchsia: 0xeb459e,
  Gold: 0xf1c40f,
  Orange: 0xe67e22,
  Red: 0xed4245,
  Grey: 0x95a5a6,
  Navy: 0x34495e,
  DarkAqua: 0x11806a,
  DarkGreen: 0x1f8b4c,
  DarkBlue: 0x206694,
  DarkPurple: 0x71368a,
  DarkVividPink: 0xad1457,
  DarkGold: 0xc27c0e,
  DarkOrange: 0xa84300,
  DarkRed: 0x992d22,
  DarkGrey: 0x979c9f,
  DarkerGrey: 0x7f8c8d,
  LightGrey: 0xbcc0c0,
  DarkNavy: 0x2c3e50,
  Blurple: 0x5865f2,
  Greyple: 0x99aab5,
  DarkButNotBlack: 0x2c2f33,
  NotQuiteBlack: 0x23272a,

  // Discord status colors
  Online: 0x43b581,
  Idle: 0xfaa61a,
  DND: 0xf04747,
  Offline: 0x747f8d,

  // Semantic colors
  Success: 0x57f287,
  Warning: 0xfee75c,
  Error: 0xed4245,
  Info: 0x3498db,
} as const

export type EmbedColor = (typeof EmbedColors)[keyof typeof EmbedColors]

// ============================================================================
// EMBED LIMITS
// ============================================================================

/**
 * Discord embed limits
 * @see https://discord.com/developers/docs/resources/channel#embed-object-embed-limits
 */
export const EmbedLimits = {
  /** Maximum title length */
  Title: 256,
  /** Maximum description length */
  Description: 4096,
  /** Maximum number of fields */
  Fields: 25,
  /** Maximum field name length */
  FieldName: 256,
  /** Maximum field value length */
  FieldValue: 1024,
  /** Maximum footer text length */
  FooterText: 2048,
  /** Maximum author name length */
  AuthorName: 256,
  /** Maximum total characters in an embed */
  Total: 6000,
  /** Maximum embeds per message */
  PerMessage: 10,
} as const

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create a simple embed with title and description
 */
export function createSimpleEmbed(title: string, description: string, color?: number) {
  const embed = new EmbedBuilder().setTitle(title).setDescription(description)
  if (color !== undefined) {
    embed.setColor(color)
  }
  return embed
}

/**
 * Create an error embed
 */
export function createErrorEmbed(title: string, description: string) {
  return createSimpleEmbed(title, description, EmbedColors.Error)
}

/**
 * Create a success embed
 */
export function createSuccessEmbed(title: string, description: string) {
  return createSimpleEmbed(title, description, EmbedColors.Success)
}

/**
 * Create a warning embed
 */
export function createWarningEmbed(title: string, description: string) {
  return createSimpleEmbed(title, description, EmbedColors.Warning)
}

/**
 * Create an info embed
 */
export function createInfoEmbed(title: string, description: string) {
  return createSimpleEmbed(title, description, EmbedColors.Info)
}

/**
 * Calculate the total character count of an embed
 */
export function calculateEmbedLength(embed: {
  title?: string
  description?: string
  fields?: { name: string; value: string }[]
  footer?: { text: string }
  author?: { name: string }
}): number {
  let total = 0

  if (embed.title) total += embed.title.length
  if (embed.description) total += embed.description.length
  if (embed.footer?.text) total += embed.footer.text.length
  if (embed.author?.name) total += embed.author.name.length

  if (embed.fields) {
    for (const field of embed.fields) {
      total += field.name.length + field.value.length
    }
  }

  return total
}

/**
 * Check if an embed exceeds Discord's limits
 */
export function validateEmbed(embed: {
  title?: string
  description?: string
  fields?: { name: string; value: string }[]
  footer?: { text: string }
  author?: { name: string }
}): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (embed.title && embed.title.length > EmbedLimits.Title) {
    errors.push(`Title exceeds ${EmbedLimits.Title} characters`)
  }

  if (embed.description && embed.description.length > EmbedLimits.Description) {
    errors.push(`Description exceeds ${EmbedLimits.Description} characters`)
  }

  if (embed.footer?.text && embed.footer.text.length > EmbedLimits.FooterText) {
    errors.push(`Footer text exceeds ${EmbedLimits.FooterText} characters`)
  }

  if (embed.author?.name && embed.author.name.length > EmbedLimits.AuthorName) {
    errors.push(`Author name exceeds ${EmbedLimits.AuthorName} characters`)
  }

  if (embed.fields) {
    if (embed.fields.length > EmbedLimits.Fields) {
      errors.push(`Number of fields exceeds ${EmbedLimits.Fields}`)
    }

    for (let i = 0; i < embed.fields.length; i++) {
      const field = embed.fields[i]
      if (field && field.name.length > EmbedLimits.FieldName) {
        errors.push(`Field ${i + 1} name exceeds ${EmbedLimits.FieldName} characters`)
      }
      if (field && field.value.length > EmbedLimits.FieldValue) {
        errors.push(`Field ${i + 1} value exceeds ${EmbedLimits.FieldValue} characters`)
      }
    }
  }

  const totalLength = calculateEmbedLength(embed)
  if (totalLength > EmbedLimits.Total) {
    errors.push(`Total embed length (${totalLength}) exceeds ${EmbedLimits.Total} characters`)
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * @dotdo/discord - Discord SDK Compatibility Layer
 *
 * Drop-in replacement for discord.js with edge runtime support.
 *
 * @example
 * ```typescript
 * import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from '@dotdo/discord'
 *
 * const client = new Client({
 *   intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
 * })
 *
 * client.on('ready', () => {
 *   console.log(`Logged in as ${client.user.tag}`)
 * })
 *
 * client.on('messageCreate', async (message) => {
 *   if (message.content === '!ping') {
 *     await message.reply('Pong!')
 *   }
 * })
 *
 * client.on('interactionCreate', async (interaction) => {
 *   if (!interaction.isChatInputCommand()) return
 *
 *   if (interaction.commandName === 'ping') {
 *     await interaction.reply('Pong!')
 *   }
 * })
 *
 * await client.login('bot-token')
 *
 * // REST API for slash commands
 * const rest = new REST({ version: '10' }).setToken('bot-token')
 *
 * const commands = [
 *   new SlashCommandBuilder()
 *     .setName('ping')
 *     .setDescription('Replies with Pong!'),
 * ]
 *
 * await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
 *   body: commands,
 * })
 *
 * // Webhooks
 * const webhook = await channel.createWebhook({ name: 'Test Hook' })
 * await webhook.send({ content: 'Hello from webhook!' })
 * ```
 *
 * @module @dotdo/discord
 */

// Re-export from client
export {
  Client,
  ClientUser,
  ClientMessage,
  ClientInteraction,
  ClientGuild,
  ClientGuildMember,
} from './client'

// Re-export from REST
export { REST, Routes, DiscordError } from './rest'

// Re-export from builders
export {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  ModalBuilder,
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
} from './builders'

// Re-export from types
export {
  // Enums
  GatewayIntentBits,
  ChannelType,
  ButtonStyle,
  TextInputStyle,
  ComponentType,
  InteractionType,
  InteractionResponseType,
  ApplicationCommandOptionType,
  PermissionFlagsBits,
  MessageFlags,

  // Types
  type User,
  type GuildMember,
  type Role,
  type RoleTags,
  type Channel,
  type PermissionOverwrite,
  type ThreadMetadata,
  type ThreadMember,
  type Guild,
  type Emoji,
  type WelcomeScreen,
  type WelcomeScreenChannel,
  type Sticker,
  type Message,
  type ChannelMention,
  type Attachment,
  type Embed,
  type EmbedFooter,
  type EmbedImage,
  type EmbedThumbnail,
  type EmbedVideo,
  type EmbedProvider,
  type EmbedAuthor,
  type EmbedField,
  type Reaction,
  type PartialEmoji,
  type MessageActivity,
  type Application,
  type Team,
  type TeamMember,
  type InstallParams,
  type MessageReference,
  type MessageInteraction,
  type StickerItem,
  type Component,
  type SelectOption,
  type Webhook,
  type Interaction,
  type InteractionData,
  type ResolvedData,
  type ApplicationCommandInteractionDataOption,
  type CommandInteraction,
  type ButtonInteraction,
  type SelectMenuInteraction,
  type ModalSubmitInteraction,
  type ClientOptions,
  type RESTOptions,
  type RequestOptions,
} from './types'

// Re-export from messages module
export {
  MessagePayload,
  MessageEditPayload,
  createTextMessage,
  createEmbedMessage,
  createReply,
  createEphemeralMessage,
  type MessagePayloadOptions,
  type AllowedMentions,
  type MessageReference as MessageReferencePayload,
  type AttachmentPayload,
  type MessageEditOptions,
} from './messages'

// Re-export from embeds module
export {
  EmbedColors,
  EmbedLimits,
  createSimpleEmbed,
  createErrorEmbed,
  createSuccessEmbed,
  createWarningEmbed,
  createInfoEmbed,
  calculateEmbedLength,
  validateEmbed,
  type EmbedColor,
} from './embeds'

// Re-export from interactions module
export {
  InteractionResponseBuilder,
  verifyInteraction,
  isSlashCommand,
  isButtonInteraction,
  isSelectMenuInteraction,
  isModalSubmit,
  isAutocomplete,
  getOption,
  getOptions,
  getSubcommand,
  getSubcommandGroup,
  getInteractionUser,
  getSelectedValues,
  getModalValues,
  createPongResponse,
  createMessageResponse,
  createDeferredResponse,
  createDeferredUpdateResponse,
  createUpdateResponse,
  createModalResponse,
  createAutocompleteResponse,
  type InteractionResponseData,
  type ModalResponseData,
  type AutocompleteChoice,
} from './interactions'

// Re-export from webhooks module
export {
  WebhookClient,
  WebhookPayloadBuilder,
  WebhookManager,
  parseWebhookUrl,
  createWebhookFromUrl,
  sendWebhookMessage,
  sendWebhookEmbed,
  type WebhookClientOptions,
  type WebhookPayload,
  type WebhookEditPayload,
} from './webhooks'

// Default export
export { Client as default } from './client'

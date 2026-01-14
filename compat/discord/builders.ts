/**
 * @dotdo/discord - Builders
 *
 * Builder classes for Discord message components, embeds, and slash commands
 *
 * @example
 * ```typescript
 * import {
 *   SlashCommandBuilder,
 *   EmbedBuilder,
 *   ActionRowBuilder,
 *   ButtonBuilder,
 *   ButtonStyle
 * } from '@dotdo/discord'
 *
 * // Build a slash command
 * const command = new SlashCommandBuilder()
 *   .setName('ping')
 *   .setDescription('Pong!')
 *
 * // Build an embed
 * const embed = new EmbedBuilder()
 *   .setTitle('Hello')
 *   .setColor(0x00ff00)
 *
 * // Build a button row
 * const row = new ActionRowBuilder<ButtonBuilder>()
 *   .addComponents(
 *     new ButtonBuilder()
 *       .setCustomId('click')
 *       .setLabel('Click Me')
 *       .setStyle(ButtonStyle.Primary)
 *   )
 * ```
 */

import {
  ApplicationCommandOptionType,
  ButtonStyle,
  ComponentType,
  TextInputStyle,
  type Embed,
  type EmbedField,
  type EmbedFooter,
  type EmbedAuthor,
  type Component,
  type SelectOption,
  type PartialEmoji,
} from './types'

// ============================================================================
// EMBED BUILDER
// ============================================================================

/**
 * Builder for Discord embeds
 */
export class EmbedBuilder {
  private data: Embed = {}

  /**
   * Set the embed title
   */
  setTitle(title: string): this {
    this.data.title = title
    return this
  }

  /**
   * Set the embed description
   */
  setDescription(description: string): this {
    this.data.description = description
    return this
  }

  /**
   * Set the embed URL (makes title clickable)
   */
  setURL(url: string): this {
    this.data.url = url
    return this
  }

  /**
   * Set the embed color (decimal number)
   */
  setColor(color: number): this {
    this.data.color = color
    return this
  }

  /**
   * Set the embed timestamp
   */
  setTimestamp(timestamp?: Date | number | string): this {
    if (timestamp === undefined) {
      this.data.timestamp = new Date().toISOString()
    } else if (timestamp instanceof Date) {
      this.data.timestamp = timestamp.toISOString()
    } else if (typeof timestamp === 'number') {
      this.data.timestamp = new Date(timestamp).toISOString()
    } else {
      this.data.timestamp = timestamp
    }
    return this
  }

  /**
   * Set the embed footer
   */
  setFooter(footer: { text: string; iconURL?: string }): this {
    this.data.footer = {
      text: footer.text,
      icon_url: footer.iconURL,
    }
    return this
  }

  /**
   * Set the embed thumbnail
   */
  setThumbnail(url: string): this {
    this.data.thumbnail = { url }
    return this
  }

  /**
   * Set the embed image
   */
  setImage(url: string): this {
    this.data.image = { url }
    return this
  }

  /**
   * Set the embed author
   */
  setAuthor(author: { name: string; iconURL?: string; url?: string }): this {
    this.data.author = {
      name: author.name,
      icon_url: author.iconURL,
      url: author.url,
    }
    return this
  }

  /**
   * Add fields to the embed
   */
  addFields(...fields: EmbedField[]): this {
    if (!this.data.fields) {
      this.data.fields = []
    }
    this.data.fields.push(...fields)
    return this
  }

  /**
   * Set all fields (replaces existing)
   */
  setFields(fields: EmbedField[]): this {
    this.data.fields = fields
    return this
  }

  /**
   * Splice fields at a position
   */
  spliceFields(index: number, deleteCount: number, ...fields: EmbedField[]): this {
    if (!this.data.fields) {
      this.data.fields = []
    }
    this.data.fields.splice(index, deleteCount, ...fields)
    return this
  }

  /**
   * Convert to JSON
   */
  toJSON(): Embed {
    return { ...this.data }
  }
}

// ============================================================================
// ACTION ROW BUILDER
// ============================================================================

/**
 * Builder for action rows (component containers)
 */
export class ActionRowBuilder<T extends ButtonBuilder | StringSelectMenuBuilder | TextInputBuilder = ButtonBuilder> {
  private components: T[] = []

  /**
   * Add components to the row
   */
  addComponents(...components: T[]): this {
    this.components.push(...components)
    return this
  }

  /**
   * Set all components (replaces existing)
   */
  setComponents(...components: T[]): this {
    this.components = components
    return this
  }

  /**
   * Convert to JSON
   */
  toJSON(): Component {
    return {
      type: ComponentType.ActionRow,
      components: this.components.map(c => c.toJSON()),
    }
  }
}

// ============================================================================
// BUTTON BUILDER
// ============================================================================

/**
 * Builder for buttons
 */
export class ButtonBuilder {
  private data: Partial<Component> = {
    type: ComponentType.Button,
  }

  /**
   * Set the custom ID
   */
  setCustomId(customId: string): this {
    this.data.custom_id = customId
    return this
  }

  /**
   * Set the button label
   */
  setLabel(label: string): this {
    this.data.label = label
    return this
  }

  /**
   * Set the button style
   */
  setStyle(style: ButtonStyle): this {
    this.data.style = style
    return this
  }

  /**
   * Set the button URL (for Link buttons)
   */
  setURL(url: string): this {
    this.data.url = url
    return this
  }

  /**
   * Set the button emoji
   */
  setEmoji(emoji: PartialEmoji | { name: string; id?: string; animated?: boolean }): this {
    this.data.emoji = emoji as PartialEmoji
    return this
  }

  /**
   * Set whether the button is disabled
   */
  setDisabled(disabled: boolean): this {
    this.data.disabled = disabled
    return this
  }

  /**
   * Convert to JSON
   */
  toJSON(): Component {
    return { ...this.data } as Component
  }
}

// ============================================================================
// STRING SELECT MENU BUILDER
// ============================================================================

/**
 * Builder for string select menus
 */
export class StringSelectMenuBuilder {
  private data: Partial<Component> = {
    type: ComponentType.StringSelect,
    options: [],
  }

  /**
   * Set the custom ID
   */
  setCustomId(customId: string): this {
    this.data.custom_id = customId
    return this
  }

  /**
   * Set the placeholder text
   */
  setPlaceholder(placeholder: string): this {
    this.data.placeholder = placeholder
    return this
  }

  /**
   * Set minimum values
   */
  setMinValues(minValues: number): this {
    this.data.min_values = minValues
    return this
  }

  /**
   * Set maximum values
   */
  setMaxValues(maxValues: number): this {
    this.data.max_values = maxValues
    return this
  }

  /**
   * Set whether the select is disabled
   */
  setDisabled(disabled: boolean): this {
    this.data.disabled = disabled
    return this
  }

  /**
   * Add options
   */
  addOptions(...options: SelectOption[]): this {
    if (!this.data.options) {
      this.data.options = []
    }
    this.data.options.push(...options)
    return this
  }

  /**
   * Set all options (replaces existing)
   */
  setOptions(...options: SelectOption[]): this {
    this.data.options = options
    return this
  }

  /**
   * Convert to JSON
   */
  toJSON(): Component {
    return { ...this.data } as Component
  }
}

// ============================================================================
// TEXT INPUT BUILDER
// ============================================================================

/**
 * Builder for text inputs (in modals)
 */
export class TextInputBuilder {
  private data: Partial<Component> = {
    type: ComponentType.TextInput,
  }

  /**
   * Set the custom ID
   */
  setCustomId(customId: string): this {
    this.data.custom_id = customId
    return this
  }

  /**
   * Set the input label
   */
  setLabel(label: string): this {
    this.data.label = label
    return this
  }

  /**
   * Set the input style
   */
  setStyle(style: TextInputStyle): this {
    this.data.style = style as unknown as ButtonStyle
    return this
  }

  /**
   * Set the placeholder text
   */
  setPlaceholder(placeholder: string): this {
    this.data.placeholder = placeholder
    return this
  }

  /**
   * Set the default value
   */
  setValue(value: string): this {
    this.data.value = value
    return this
  }

  /**
   * Set whether the input is required
   */
  setRequired(required: boolean): this {
    this.data.required = required
    return this
  }

  /**
   * Set minimum length
   */
  setMinLength(minLength: number): this {
    this.data.min_length = minLength
    return this
  }

  /**
   * Set maximum length
   */
  setMaxLength(maxLength: number): this {
    this.data.max_length = maxLength
    return this
  }

  /**
   * Convert to JSON
   */
  toJSON(): Component {
    return { ...this.data } as Component
  }
}

// ============================================================================
// MODAL BUILDER
// ============================================================================

interface ModalData {
  custom_id?: string
  title?: string
  components: Component[]
}

/**
 * Builder for modals
 */
export class ModalBuilder {
  private data: ModalData = {
    components: [],
  }

  /**
   * Set the custom ID
   */
  setCustomId(customId: string): this {
    this.data.custom_id = customId
    return this
  }

  /**
   * Set the modal title
   */
  setTitle(title: string): this {
    this.data.title = title
    return this
  }

  /**
   * Add components (action rows with text inputs)
   */
  addComponents(...components: ActionRowBuilder<TextInputBuilder>[]): this {
    this.data.components.push(...components.map(c => c.toJSON()))
    return this
  }

  /**
   * Set all components (replaces existing)
   */
  setComponents(...components: ActionRowBuilder<TextInputBuilder>[]): this {
    this.data.components = components.map(c => c.toJSON())
    return this
  }

  /**
   * Convert to JSON
   */
  toJSON(): ModalData {
    return { ...this.data }
  }
}

// ============================================================================
// SLASH COMMAND BUILDER
// ============================================================================

interface SlashCommandOption {
  type: ApplicationCommandOptionType
  name: string
  description: string
  required?: boolean
  choices?: { name: string; value: string | number }[]
  options?: SlashCommandOption[]
  min_value?: number
  max_value?: number
  min_length?: number
  max_length?: number
  autocomplete?: boolean
  channel_types?: number[]
}

interface SlashCommandData {
  name?: string
  description?: string
  options?: SlashCommandOption[]
  default_member_permissions?: string
  dm_permission?: boolean
  nsfw?: boolean
}

/**
 * Builder for slash commands
 */
export class SlashCommandBuilder {
  private data: SlashCommandData = {}

  /**
   * Set the command name
   */
  setName(name: string): this {
    this.data.name = name
    return this
  }

  /**
   * Set the command description
   */
  setDescription(description: string): this {
    this.data.description = description
    return this
  }

  /**
   * Set default member permissions
   */
  setDefaultMemberPermissions(permissions: bigint | null): this {
    this.data.default_member_permissions = permissions ? String(permissions) : null as any
    return this
  }

  /**
   * Set whether the command is available in DMs
   */
  setDMPermission(enabled: boolean): this {
    this.data.dm_permission = enabled
    return this
  }

  /**
   * Set whether the command is NSFW
   */
  setNSFW(nsfw: boolean): this {
    this.data.nsfw = nsfw
    return this
  }

  /**
   * Add a string option
   */
  addStringOption(fn: (option: SlashCommandStringOption) => SlashCommandStringOption): this {
    const option = fn(new SlashCommandStringOption())
    if (!this.data.options) {
      this.data.options = []
    }
    this.data.options.push(option.toJSON())
    return this
  }

  /**
   * Add an integer option
   */
  addIntegerOption(fn: (option: SlashCommandIntegerOption) => SlashCommandIntegerOption): this {
    const option = fn(new SlashCommandIntegerOption())
    if (!this.data.options) {
      this.data.options = []
    }
    this.data.options.push(option.toJSON())
    return this
  }

  /**
   * Add a number option
   */
  addNumberOption(fn: (option: SlashCommandNumberOption) => SlashCommandNumberOption): this {
    const option = fn(new SlashCommandNumberOption())
    if (!this.data.options) {
      this.data.options = []
    }
    this.data.options.push(option.toJSON())
    return this
  }

  /**
   * Add a boolean option
   */
  addBooleanOption(fn: (option: SlashCommandBooleanOption) => SlashCommandBooleanOption): this {
    const option = fn(new SlashCommandBooleanOption())
    if (!this.data.options) {
      this.data.options = []
    }
    this.data.options.push(option.toJSON())
    return this
  }

  /**
   * Add a user option
   */
  addUserOption(fn: (option: SlashCommandUserOption) => SlashCommandUserOption): this {
    const option = fn(new SlashCommandUserOption())
    if (!this.data.options) {
      this.data.options = []
    }
    this.data.options.push(option.toJSON())
    return this
  }

  /**
   * Add a channel option
   */
  addChannelOption(fn: (option: SlashCommandChannelOption) => SlashCommandChannelOption): this {
    const option = fn(new SlashCommandChannelOption())
    if (!this.data.options) {
      this.data.options = []
    }
    this.data.options.push(option.toJSON())
    return this
  }

  /**
   * Add a role option
   */
  addRoleOption(fn: (option: SlashCommandRoleOption) => SlashCommandRoleOption): this {
    const option = fn(new SlashCommandRoleOption())
    if (!this.data.options) {
      this.data.options = []
    }
    this.data.options.push(option.toJSON())
    return this
  }

  /**
   * Add a mentionable option
   */
  addMentionableOption(fn: (option: SlashCommandMentionableOption) => SlashCommandMentionableOption): this {
    const option = fn(new SlashCommandMentionableOption())
    if (!this.data.options) {
      this.data.options = []
    }
    this.data.options.push(option.toJSON())
    return this
  }

  /**
   * Add an attachment option
   */
  addAttachmentOption(fn: (option: SlashCommandAttachmentOption) => SlashCommandAttachmentOption): this {
    const option = fn(new SlashCommandAttachmentOption())
    if (!this.data.options) {
      this.data.options = []
    }
    this.data.options.push(option.toJSON())
    return this
  }

  /**
   * Add a subcommand
   */
  addSubcommand(fn: (subcommand: SlashCommandSubcommandBuilder) => SlashCommandSubcommandBuilder): this {
    const subcommand = fn(new SlashCommandSubcommandBuilder())
    if (!this.data.options) {
      this.data.options = []
    }
    this.data.options.push(subcommand.toJSON())
    return this
  }

  /**
   * Add a subcommand group
   */
  addSubcommandGroup(fn: (group: SlashCommandSubcommandGroupBuilder) => SlashCommandSubcommandGroupBuilder): this {
    const group = fn(new SlashCommandSubcommandGroupBuilder())
    if (!this.data.options) {
      this.data.options = []
    }
    this.data.options.push(group.toJSON())
    return this
  }

  /**
   * Convert to JSON
   */
  toJSON(): SlashCommandData {
    return { ...this.data }
  }
}

// ============================================================================
// SLASH COMMAND OPTION BUILDERS
// ============================================================================

class SlashCommandOptionBase {
  protected data: Partial<SlashCommandOption> = {}

  setName(name: string): this {
    this.data.name = name
    return this
  }

  setDescription(description: string): this {
    this.data.description = description
    return this
  }

  setRequired(required: boolean): this {
    this.data.required = required
    return this
  }

  toJSON(): SlashCommandOption {
    return this.data as SlashCommandOption
  }
}

export class SlashCommandStringOption extends SlashCommandOptionBase {
  constructor() {
    super()
    this.data.type = ApplicationCommandOptionType.String
  }

  addChoices(...choices: { name: string; value: string }[]): this {
    if (!this.data.choices) {
      this.data.choices = []
    }
    this.data.choices.push(...choices)
    return this
  }

  setMinLength(minLength: number): this {
    this.data.min_length = minLength
    return this
  }

  setMaxLength(maxLength: number): this {
    this.data.max_length = maxLength
    return this
  }

  setAutocomplete(autocomplete: boolean): this {
    this.data.autocomplete = autocomplete
    return this
  }
}

export class SlashCommandIntegerOption extends SlashCommandOptionBase {
  constructor() {
    super()
    this.data.type = ApplicationCommandOptionType.Integer
  }

  addChoices(...choices: { name: string; value: number }[]): this {
    if (!this.data.choices) {
      this.data.choices = []
    }
    this.data.choices.push(...choices)
    return this
  }

  setMinValue(minValue: number): this {
    this.data.min_value = minValue
    return this
  }

  setMaxValue(maxValue: number): this {
    this.data.max_value = maxValue
    return this
  }

  setAutocomplete(autocomplete: boolean): this {
    this.data.autocomplete = autocomplete
    return this
  }
}

export class SlashCommandNumberOption extends SlashCommandOptionBase {
  constructor() {
    super()
    this.data.type = ApplicationCommandOptionType.Number
  }

  addChoices(...choices: { name: string; value: number }[]): this {
    if (!this.data.choices) {
      this.data.choices = []
    }
    this.data.choices.push(...choices)
    return this
  }

  setMinValue(minValue: number): this {
    this.data.min_value = minValue
    return this
  }

  setMaxValue(maxValue: number): this {
    this.data.max_value = maxValue
    return this
  }

  setAutocomplete(autocomplete: boolean): this {
    this.data.autocomplete = autocomplete
    return this
  }
}

export class SlashCommandBooleanOption extends SlashCommandOptionBase {
  constructor() {
    super()
    this.data.type = ApplicationCommandOptionType.Boolean
  }
}

export class SlashCommandUserOption extends SlashCommandOptionBase {
  constructor() {
    super()
    this.data.type = ApplicationCommandOptionType.User
  }
}

export class SlashCommandChannelOption extends SlashCommandOptionBase {
  constructor() {
    super()
    this.data.type = ApplicationCommandOptionType.Channel
  }

  addChannelTypes(...types: number[]): this {
    this.data.channel_types = types
    return this
  }
}

export class SlashCommandRoleOption extends SlashCommandOptionBase {
  constructor() {
    super()
    this.data.type = ApplicationCommandOptionType.Role
  }
}

export class SlashCommandMentionableOption extends SlashCommandOptionBase {
  constructor() {
    super()
    this.data.type = ApplicationCommandOptionType.Mentionable
  }
}

export class SlashCommandAttachmentOption extends SlashCommandOptionBase {
  constructor() {
    super()
    this.data.type = ApplicationCommandOptionType.Attachment
  }
}

/**
 * Builder for subcommands
 */
export class SlashCommandSubcommandBuilder {
  private data: Partial<SlashCommandOption> = {
    type: ApplicationCommandOptionType.SubCommand,
    options: [],
  }

  setName(name: string): this {
    this.data.name = name
    return this
  }

  setDescription(description: string): this {
    this.data.description = description
    return this
  }

  addStringOption(fn: (option: SlashCommandStringOption) => SlashCommandStringOption): this {
    const option = fn(new SlashCommandStringOption())
    this.data.options!.push(option.toJSON())
    return this
  }

  addIntegerOption(fn: (option: SlashCommandIntegerOption) => SlashCommandIntegerOption): this {
    const option = fn(new SlashCommandIntegerOption())
    this.data.options!.push(option.toJSON())
    return this
  }

  addNumberOption(fn: (option: SlashCommandNumberOption) => SlashCommandNumberOption): this {
    const option = fn(new SlashCommandNumberOption())
    this.data.options!.push(option.toJSON())
    return this
  }

  addBooleanOption(fn: (option: SlashCommandBooleanOption) => SlashCommandBooleanOption): this {
    const option = fn(new SlashCommandBooleanOption())
    this.data.options!.push(option.toJSON())
    return this
  }

  addUserOption(fn: (option: SlashCommandUserOption) => SlashCommandUserOption): this {
    const option = fn(new SlashCommandUserOption())
    this.data.options!.push(option.toJSON())
    return this
  }

  addChannelOption(fn: (option: SlashCommandChannelOption) => SlashCommandChannelOption): this {
    const option = fn(new SlashCommandChannelOption())
    this.data.options!.push(option.toJSON())
    return this
  }

  addRoleOption(fn: (option: SlashCommandRoleOption) => SlashCommandRoleOption): this {
    const option = fn(new SlashCommandRoleOption())
    this.data.options!.push(option.toJSON())
    return this
  }

  addMentionableOption(fn: (option: SlashCommandMentionableOption) => SlashCommandMentionableOption): this {
    const option = fn(new SlashCommandMentionableOption())
    this.data.options!.push(option.toJSON())
    return this
  }

  addAttachmentOption(fn: (option: SlashCommandAttachmentOption) => SlashCommandAttachmentOption): this {
    const option = fn(new SlashCommandAttachmentOption())
    this.data.options!.push(option.toJSON())
    return this
  }

  toJSON(): SlashCommandOption {
    return this.data as SlashCommandOption
  }
}

/**
 * Builder for subcommand groups
 */
export class SlashCommandSubcommandGroupBuilder {
  private data: Partial<SlashCommandOption> = {
    type: ApplicationCommandOptionType.SubCommandGroup,
    options: [],
  }

  setName(name: string): this {
    this.data.name = name
    return this
  }

  setDescription(description: string): this {
    this.data.description = description
    return this
  }

  addSubcommand(fn: (subcommand: SlashCommandSubcommandBuilder) => SlashCommandSubcommandBuilder): this {
    const subcommand = fn(new SlashCommandSubcommandBuilder())
    this.data.options!.push(subcommand.toJSON())
    return this
  }

  toJSON(): SlashCommandOption {
    return this.data as SlashCommandOption
  }
}

/**
 * @dotdo/slack - Block Kit Builder
 *
 * Fluent API for building Slack Block Kit layouts
 *
 * @example
 * ```typescript
 * import { Blocks, section, divider, mrkdwn, plainText, button } from '@dotdo/slack/blocks'
 *
 * const blocks = new Blocks()
 *   .header({ text: plainText('Order Confirmation') })
 *   .section({
 *     text: mrkdwn('Your order has been *confirmed*!'),
 *     accessory: button({
 *       text: plainText('View Order'),
 *       action_id: 'view_order',
 *     }),
 *   })
 *   .divider()
 *   .section({
 *     fields: [
 *       mrkdwn('*Order ID:*\n12345'),
 *       mrkdwn('*Status:*\nProcessing'),
 *     ],
 *   })
 *   .build()
 * ```
 *
 * @see https://api.slack.com/block-kit
 */

// ============================================================================
// TEXT OBJECTS
// ============================================================================

/**
 * Plain text object
 */
export interface PlainTextObject {
  type: 'plain_text'
  text: string
  emoji?: boolean
}

/**
 * Markdown text object
 */
export interface MrkdwnObject {
  type: 'mrkdwn'
  text: string
  verbatim?: boolean
}

/**
 * Text object (either plain_text or mrkdwn)
 */
export type TextObject = PlainTextObject | MrkdwnObject

/**
 * Create a plain text object
 */
export function plainText(text: string, emoji = true): PlainTextObject {
  return { type: 'plain_text', text, emoji }
}

/**
 * Create a mrkdwn text object
 */
export function mrkdwn(text: string, verbatim?: boolean): MrkdwnObject {
  const obj: MrkdwnObject = { type: 'mrkdwn', text }
  if (verbatim !== undefined) obj.verbatim = verbatim
  return obj
}

// ============================================================================
// CONFIRMATION DIALOG
// ============================================================================

/**
 * Confirmation dialog object
 */
export interface ConfirmDialog {
  title?: PlainTextObject
  text: TextObject
  confirm: PlainTextObject
  deny: PlainTextObject
  style?: 'primary' | 'danger'
}

// ============================================================================
// OPTION OBJECTS
// ============================================================================

/**
 * Option object for select menus
 */
export interface Option {
  text: PlainTextObject | MrkdwnObject
  value: string
  description?: PlainTextObject
  url?: string
}

/**
 * Option group for select menus
 */
export interface OptionGroup {
  label: PlainTextObject
  options: Option[]
}

/**
 * Create an option object
 */
export function option(args: {
  text: PlainTextObject | MrkdwnObject
  value: string
  description?: PlainTextObject
  url?: string
}): Option {
  return { ...args }
}

// ============================================================================
// INTERACTIVE ELEMENTS
// ============================================================================

/**
 * Button element
 */
export interface ButtonElement {
  type: 'button'
  text: PlainTextObject
  action_id: string
  url?: string
  value?: string
  style?: 'primary' | 'danger'
  confirm?: ConfirmDialog
  accessibility_label?: string
}

/**
 * Create a button element
 */
export function button(args: {
  text: PlainTextObject
  action_id: string
  url?: string
  value?: string
  style?: 'primary' | 'danger'
  confirm?: ConfirmDialog
  accessibility_label?: string
}): ButtonElement {
  return { type: 'button', ...args }
}

/**
 * Static select element
 */
export interface StaticSelectElement {
  type: 'static_select'
  action_id: string
  placeholder?: PlainTextObject
  options?: Option[]
  option_groups?: OptionGroup[]
  initial_option?: Option
  confirm?: ConfirmDialog
  focus_on_load?: boolean
}

/**
 * Create a static select element
 */
export function staticSelect(args: {
  action_id: string
  placeholder?: PlainTextObject
  options?: Option[]
  option_groups?: OptionGroup[]
  initial_option?: Option
  confirm?: ConfirmDialog
  focus_on_load?: boolean
}): StaticSelectElement {
  return { type: 'static_select', ...args }
}

/**
 * Multi static select element
 */
export interface MultiStaticSelectElement {
  type: 'multi_static_select'
  action_id: string
  placeholder?: PlainTextObject
  options?: Option[]
  option_groups?: OptionGroup[]
  initial_options?: Option[]
  max_selected_items?: number
  confirm?: ConfirmDialog
  focus_on_load?: boolean
}

/**
 * Create a multi static select element
 */
export function multiStaticSelect(args: {
  action_id: string
  placeholder?: PlainTextObject
  options?: Option[]
  option_groups?: OptionGroup[]
  initial_options?: Option[]
  max_selected_items?: number
  confirm?: ConfirmDialog
  focus_on_load?: boolean
}): MultiStaticSelectElement {
  return { type: 'multi_static_select', ...args }
}

/**
 * Overflow menu element
 */
export interface OverflowElement {
  type: 'overflow'
  action_id: string
  options: Option[]
  confirm?: ConfirmDialog
}

/**
 * Create an overflow menu element
 */
export function overflow(args: {
  action_id: string
  options: Option[]
  confirm?: ConfirmDialog
}): OverflowElement {
  return { type: 'overflow', ...args }
}

/**
 * Date picker element
 */
export interface DatePickerElement {
  type: 'datepicker'
  action_id: string
  placeholder?: PlainTextObject
  initial_date?: string
  confirm?: ConfirmDialog
  focus_on_load?: boolean
}

/**
 * Create a date picker element
 */
export function datePicker(args: {
  action_id: string
  placeholder?: PlainTextObject
  initial_date?: string
  confirm?: ConfirmDialog
  focus_on_load?: boolean
}): DatePickerElement {
  return { type: 'datepicker', ...args }
}

/**
 * Time picker element
 */
export interface TimePickerElement {
  type: 'timepicker'
  action_id: string
  placeholder?: PlainTextObject
  initial_time?: string
  confirm?: ConfirmDialog
  focus_on_load?: boolean
  timezone?: string
}

/**
 * Create a time picker element
 */
export function timePicker(args: {
  action_id: string
  placeholder?: PlainTextObject
  initial_time?: string
  confirm?: ConfirmDialog
  focus_on_load?: boolean
  timezone?: string
}): TimePickerElement {
  return { type: 'timepicker', ...args }
}

/**
 * Plain text input element
 */
export interface PlainTextInputElement {
  type: 'plain_text_input'
  action_id: string
  placeholder?: PlainTextObject
  initial_value?: string
  multiline?: boolean
  min_length?: number
  max_length?: number
  dispatch_action_config?: {
    trigger_actions_on?: ('on_enter_pressed' | 'on_character_entered')[]
  }
  focus_on_load?: boolean
}

/**
 * Create a plain text input element
 */
export function textInput(args: {
  action_id: string
  placeholder?: PlainTextObject
  initial_value?: string
  multiline?: boolean
  min_length?: number
  max_length?: number
  dispatch_action_config?: {
    trigger_actions_on?: ('on_enter_pressed' | 'on_character_entered')[]
  }
  focus_on_load?: boolean
}): PlainTextInputElement {
  return { type: 'plain_text_input', ...args }
}

/**
 * Checkboxes element
 */
export interface CheckboxesElement {
  type: 'checkboxes'
  action_id: string
  options: Option[]
  initial_options?: Option[]
  confirm?: ConfirmDialog
  focus_on_load?: boolean
}

/**
 * Create a checkboxes element
 */
export function checkboxes(args: {
  action_id: string
  options: Option[]
  initial_options?: Option[]
  confirm?: ConfirmDialog
  focus_on_load?: boolean
}): CheckboxesElement {
  return { type: 'checkboxes', ...args }
}

/**
 * Radio buttons element
 */
export interface RadioButtonsElement {
  type: 'radio_buttons'
  action_id: string
  options: Option[]
  initial_option?: Option
  confirm?: ConfirmDialog
  focus_on_load?: boolean
}

/**
 * Create a radio buttons element
 */
export function radioButtons(args: {
  action_id: string
  options: Option[]
  initial_option?: Option
  confirm?: ConfirmDialog
  focus_on_load?: boolean
}): RadioButtonsElement {
  return { type: 'radio_buttons', ...args }
}

/**
 * Users select element
 */
export interface UsersSelectElement {
  type: 'users_select'
  action_id: string
  placeholder?: PlainTextObject
  initial_user?: string
  confirm?: ConfirmDialog
  focus_on_load?: boolean
}

/**
 * Create a users select element
 */
export function usersSelect(args: {
  action_id: string
  placeholder?: PlainTextObject
  initial_user?: string
  confirm?: ConfirmDialog
  focus_on_load?: boolean
}): UsersSelectElement {
  return { type: 'users_select', ...args }
}

/**
 * Conversations select element
 */
export interface ConversationsSelectElement {
  type: 'conversations_select'
  action_id: string
  placeholder?: PlainTextObject
  initial_conversation?: string
  default_to_current_conversation?: boolean
  confirm?: ConfirmDialog
  filter?: {
    include?: ('im' | 'mpim' | 'private' | 'public')[]
    exclude_external_shared_channels?: boolean
    exclude_bot_users?: boolean
  }
  focus_on_load?: boolean
}

/**
 * Create a conversations select element
 */
export function conversationsSelect(args: {
  action_id: string
  placeholder?: PlainTextObject
  initial_conversation?: string
  default_to_current_conversation?: boolean
  confirm?: ConfirmDialog
  filter?: {
    include?: ('im' | 'mpim' | 'private' | 'public')[]
    exclude_external_shared_channels?: boolean
    exclude_bot_users?: boolean
  }
  focus_on_load?: boolean
}): ConversationsSelectElement {
  return { type: 'conversations_select', ...args }
}

/**
 * Channels select element
 */
export interface ChannelsSelectElement {
  type: 'channels_select'
  action_id: string
  placeholder?: PlainTextObject
  initial_channel?: string
  confirm?: ConfirmDialog
  focus_on_load?: boolean
}

/**
 * Create a channels select element
 */
export function channelsSelect(args: {
  action_id: string
  placeholder?: PlainTextObject
  initial_channel?: string
  confirm?: ConfirmDialog
  focus_on_load?: boolean
}): ChannelsSelectElement {
  return { type: 'channels_select', ...args }
}

/**
 * Image element (for use in context blocks)
 */
export interface ImageElement {
  type: 'image'
  image_url: string
  alt_text: string
}

/**
 * Create an image element
 */
export function imageElement(image_url: string, alt_text: string): ImageElement {
  return { type: 'image', image_url, alt_text }
}

/**
 * All block element types
 */
export type BlockElement =
  | ButtonElement
  | StaticSelectElement
  | MultiStaticSelectElement
  | OverflowElement
  | DatePickerElement
  | TimePickerElement
  | PlainTextInputElement
  | CheckboxesElement
  | RadioButtonsElement
  | UsersSelectElement
  | ConversationsSelectElement
  | ChannelsSelectElement
  | ImageElement

// ============================================================================
// BLOCK TYPES
// ============================================================================

/**
 * Section block
 */
export interface SectionBlock {
  type: 'section'
  block_id?: string
  text?: TextObject
  fields?: TextObject[]
  accessory?: BlockElement
}

/**
 * Create a section block
 */
export function section(args: {
  text?: TextObject
  fields?: TextObject[]
  accessory?: BlockElement
  block_id?: string
}): SectionBlock {
  return { type: 'section', ...args }
}

/**
 * Divider block
 */
export interface DividerBlock {
  type: 'divider'
  block_id?: string
}

/**
 * Create a divider block
 */
export function divider(block_id?: string): DividerBlock {
  const block: DividerBlock = { type: 'divider' }
  if (block_id) block.block_id = block_id
  return block
}

/**
 * Header block
 */
export interface HeaderBlock {
  type: 'header'
  block_id?: string
  text: PlainTextObject
}

/**
 * Create a header block
 */
export function header(args: {
  text: PlainTextObject
  block_id?: string
}): HeaderBlock {
  return { type: 'header', ...args }
}

/**
 * Context block
 */
export interface ContextBlock {
  type: 'context'
  block_id?: string
  elements: (TextObject | ImageElement)[]
}

/**
 * Create a context block
 */
export function context(args: {
  elements: (TextObject | ImageElement)[]
  block_id?: string
}): ContextBlock {
  return { type: 'context', ...args }
}

/**
 * Actions block
 */
export interface ActionsBlock {
  type: 'actions'
  block_id?: string
  elements: BlockElement[]
}

/**
 * Create an actions block
 */
export function actions(args: {
  elements: BlockElement[]
  block_id?: string
}): ActionsBlock {
  return { type: 'actions', ...args }
}

/**
 * Image block
 */
export interface ImageBlock {
  type: 'image'
  block_id?: string
  image_url: string
  alt_text: string
  title?: PlainTextObject
}

/**
 * Create an image block
 */
export function image(args: {
  image_url: string
  alt_text: string
  title?: PlainTextObject
  block_id?: string
}): ImageBlock {
  return { type: 'image', ...args }
}

/**
 * Input block
 */
export interface InputBlock {
  type: 'input'
  block_id?: string
  label: PlainTextObject
  element: PlainTextInputElement | StaticSelectElement | MultiStaticSelectElement | UsersSelectElement | ConversationsSelectElement | ChannelsSelectElement | DatePickerElement | TimePickerElement | CheckboxesElement | RadioButtonsElement
  hint?: PlainTextObject
  optional?: boolean
  dispatch_action?: boolean
}

/**
 * Create an input block
 */
export function input(args: {
  label: PlainTextObject
  element: PlainTextInputElement | StaticSelectElement | MultiStaticSelectElement | UsersSelectElement | ConversationsSelectElement | ChannelsSelectElement | DatePickerElement | TimePickerElement | CheckboxesElement | RadioButtonsElement
  hint?: PlainTextObject
  optional?: boolean
  dispatch_action?: boolean
  block_id?: string
}): InputBlock {
  return { type: 'input', ...args }
}

/**
 * File block
 */
export interface FileBlock {
  type: 'file'
  block_id?: string
  external_id: string
  source: 'remote'
}

/**
 * Create a file block
 */
export function file(external_id: string, block_id?: string): FileBlock {
  const block: FileBlock = { type: 'file', external_id, source: 'remote' }
  if (block_id) block.block_id = block_id
  return block
}

/**
 * Video block
 */
export interface VideoBlock {
  type: 'video'
  block_id?: string
  alt_text: string
  author_name?: string
  description?: PlainTextObject
  provider_icon_url?: string
  provider_name?: string
  title: PlainTextObject
  title_url?: string
  thumbnail_url: string
  video_url: string
}

/**
 * Create a video block
 */
export function video(args: {
  alt_text: string
  title: PlainTextObject
  thumbnail_url: string
  video_url: string
  author_name?: string
  description?: PlainTextObject
  provider_icon_url?: string
  provider_name?: string
  title_url?: string
  block_id?: string
}): VideoBlock {
  return { type: 'video', ...args }
}

/**
 * All block types
 */
export type Block =
  | SectionBlock
  | DividerBlock
  | HeaderBlock
  | ContextBlock
  | ActionsBlock
  | ImageBlock
  | InputBlock
  | FileBlock
  | VideoBlock

// ============================================================================
// BLOCKS BUILDER CLASS
// ============================================================================

/**
 * Fluent builder for creating arrays of blocks
 */
export class Blocks {
  private _blocks: Block[] = []

  /**
   * Add a section block
   */
  section(args: {
    text?: TextObject
    fields?: TextObject[]
    accessory?: BlockElement
    block_id?: string
  }): this {
    this._blocks.push(section(args))
    return this
  }

  /**
   * Add a divider block
   */
  divider(block_id?: string): this {
    this._blocks.push(divider(block_id))
    return this
  }

  /**
   * Add a header block
   */
  header(args: { text: PlainTextObject; block_id?: string }): this {
    this._blocks.push(header(args))
    return this
  }

  /**
   * Add a context block
   */
  context(args: {
    elements: (TextObject | ImageElement)[]
    block_id?: string
  }): this {
    this._blocks.push(context(args))
    return this
  }

  /**
   * Add an actions block
   */
  actions(args: { elements: BlockElement[]; block_id?: string }): this {
    this._blocks.push(actions(args))
    return this
  }

  /**
   * Add an image block
   */
  image(args: {
    image_url: string
    alt_text: string
    title?: PlainTextObject
    block_id?: string
  }): this {
    this._blocks.push(image(args))
    return this
  }

  /**
   * Add an input block
   */
  input(args: {
    label: PlainTextObject
    element: PlainTextInputElement | StaticSelectElement | MultiStaticSelectElement | UsersSelectElement | ConversationsSelectElement | ChannelsSelectElement | DatePickerElement | TimePickerElement | CheckboxesElement | RadioButtonsElement
    hint?: PlainTextObject
    optional?: boolean
    dispatch_action?: boolean
    block_id?: string
  }): this {
    this._blocks.push(input(args))
    return this
  }

  /**
   * Add a file block
   */
  file(external_id: string, block_id?: string): this {
    this._blocks.push(file(external_id, block_id))
    return this
  }

  /**
   * Add a video block
   */
  video(args: {
    alt_text: string
    title: PlainTextObject
    thumbnail_url: string
    video_url: string
    author_name?: string
    description?: PlainTextObject
    provider_icon_url?: string
    provider_name?: string
    title_url?: string
    block_id?: string
  }): this {
    this._blocks.push(video(args))
    return this
  }

  /**
   * Add any block
   */
  add(block: Block): this {
    this._blocks.push(block)
    return this
  }

  /**
   * Build and return the array of blocks
   */
  build(): Block[] {
    return [...this._blocks]
  }
}

// ============================================================================
// MODAL AND HOME TAB BUILDERS
// ============================================================================

/**
 * Modal view definition
 */
export interface ModalView {
  type: 'modal'
  callback_id?: string
  title: PlainTextObject
  submit?: PlainTextObject
  close?: PlainTextObject
  blocks: Block[]
  private_metadata?: string
  clear_on_close?: boolean
  notify_on_close?: boolean
  external_id?: string
}

/**
 * Create a modal view
 */
export function modal(args: {
  title: PlainTextObject
  blocks: Block[]
  callback_id?: string
  submit?: PlainTextObject
  close?: PlainTextObject
  private_metadata?: string
  clear_on_close?: boolean
  notify_on_close?: boolean
  external_id?: string
}): ModalView {
  return { type: 'modal', ...args }
}

/**
 * Home tab view definition
 */
export interface HomeTabView {
  type: 'home'
  callback_id?: string
  blocks: Block[]
  private_metadata?: string
  external_id?: string
}

/**
 * Create a home tab view
 */
export function homeTab(args: {
  blocks: Block[]
  callback_id?: string
  private_metadata?: string
  external_id?: string
}): HomeTabView {
  return { type: 'home', ...args }
}

// ============================================================================
// MESSAGE HELPERS
// ============================================================================

/**
 * Message attachment
 */
export interface Attachment {
  color?: string
  fallback?: string
  pretext?: string
  author_name?: string
  author_link?: string
  author_icon?: string
  title?: string
  title_link?: string
  text?: string
  fields?: {
    title: string
    value: string
    short?: boolean
  }[]
  image_url?: string
  thumb_url?: string
  footer?: string
  footer_icon?: string
  ts?: number
  mrkdwn_in?: string[]
  blocks?: Block[]
}

/**
 * Create an attachment
 */
export function attachment(args: Attachment): Attachment {
  return args
}

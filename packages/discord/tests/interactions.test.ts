/**
 * @dotdo/discord - Interactions Module Tests
 */
import { describe, it, expect, vi } from 'vitest'

import {
  InteractionResponseBuilder,
  InteractionType,
  InteractionResponseType,
  ApplicationCommandOptionType,
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
} from '../src/interactions'

describe('InteractionResponseBuilder', () => {
  it('should build basic response', () => {
    const response = new InteractionResponseBuilder()
      .setContent('Hello!')

    const json = response.toJSON()
    expect(json.content).toBe('Hello!')
  })

  it('should build response with embeds', () => {
    const response = new InteractionResponseBuilder()
      .setEmbeds([{ title: 'Test' }])

    const json = response.toJSON()
    expect(json.embeds).toHaveLength(1)
  })

  it('should add embeds incrementally', () => {
    const response = new InteractionResponseBuilder()
      .addEmbeds({ title: 'First' })
      .addEmbeds({ title: 'Second' })

    const json = response.toJSON()
    expect(json.embeds).toHaveLength(2)
  })

  it('should build response with components', () => {
    const response = new InteractionResponseBuilder()
      .setComponents([{ type: 1, components: [] }])

    const json = response.toJSON()
    expect(json.components).toHaveLength(1)
  })

  it('should add components incrementally', () => {
    const response = new InteractionResponseBuilder()
      .addComponents({ type: 1, components: [] })
      .addComponents({ type: 1, components: [] })

    const json = response.toJSON()
    expect(json.components).toHaveLength(2)
  })

  it('should set flags', () => {
    const response = new InteractionResponseBuilder()
      .setFlags(64)

    const json = response.toJSON()
    expect(json.flags).toBe(64)
  })

  it('should set ephemeral', () => {
    const response = new InteractionResponseBuilder()
      .setEphemeral()

    const json = response.toJSON()
    expect(json.flags! & 64).toBe(64)
  })

  it('should unset ephemeral', () => {
    const response = new InteractionResponseBuilder()
      .setFlags(64)
      .setEphemeral(false)

    const json = response.toJSON()
    expect(json.flags! & 64).toBe(0)
  })

  it('should set TTS', () => {
    const response = new InteractionResponseBuilder()
      .setTTS(true)

    const json = response.toJSON()
    expect(json.tts).toBe(true)
  })

  it('should set allowed mentions', () => {
    const response = new InteractionResponseBuilder()
      .setAllowedMentions({ parse: ['users'] })

    const json = response.toJSON()
    expect(json.allowed_mentions?.parse).toContain('users')
  })
})

describe('Interaction Type Checks', () => {
  describe('isSlashCommand', () => {
    it('should return true for slash command', () => {
      expect(isSlashCommand({ type: InteractionType.ApplicationCommand })).toBe(true)
    })

    it('should return false for other types', () => {
      expect(isSlashCommand({ type: InteractionType.MessageComponent })).toBe(false)
      expect(isSlashCommand({ type: InteractionType.ModalSubmit })).toBe(false)
    })
  })

  describe('isButtonInteraction', () => {
    it('should return true for button interaction', () => {
      expect(isButtonInteraction({
        type: InteractionType.MessageComponent,
        data: { component_type: 2 }
      })).toBe(true)
    })

    it('should return false for other component types', () => {
      expect(isButtonInteraction({
        type: InteractionType.MessageComponent,
        data: { component_type: 3 }
      })).toBe(false)
    })

    it('should return false for non-component interactions', () => {
      expect(isButtonInteraction({ type: InteractionType.ApplicationCommand })).toBe(false)
    })
  })

  describe('isSelectMenuInteraction', () => {
    it('should return true for string select', () => {
      expect(isSelectMenuInteraction({
        type: InteractionType.MessageComponent,
        data: { component_type: 3 }
      })).toBe(true)
    })

    it('should return true for user select', () => {
      expect(isSelectMenuInteraction({
        type: InteractionType.MessageComponent,
        data: { component_type: 5 }
      })).toBe(true)
    })

    it('should return true for channel select', () => {
      expect(isSelectMenuInteraction({
        type: InteractionType.MessageComponent,
        data: { component_type: 8 }
      })).toBe(true)
    })

    it('should return false for button', () => {
      expect(isSelectMenuInteraction({
        type: InteractionType.MessageComponent,
        data: { component_type: 2 }
      })).toBe(false)
    })
  })

  describe('isModalSubmit', () => {
    it('should return true for modal submit', () => {
      expect(isModalSubmit({ type: InteractionType.ModalSubmit })).toBe(true)
    })

    it('should return false for other types', () => {
      expect(isModalSubmit({ type: InteractionType.ApplicationCommand })).toBe(false)
    })
  })

  describe('isAutocomplete', () => {
    it('should return true for autocomplete', () => {
      expect(isAutocomplete({ type: InteractionType.ApplicationCommandAutocomplete })).toBe(true)
    })

    it('should return false for other types', () => {
      expect(isAutocomplete({ type: InteractionType.ApplicationCommand })).toBe(false)
    })
  })
})

describe('Option Helpers', () => {
  describe('getOption', () => {
    it('should get string option', () => {
      const interaction = {
        data: {
          options: [
            { name: 'message', value: 'Hello' },
            { name: 'count', value: 5 },
          ]
        }
      }

      expect(getOption<string>(interaction, 'message')).toBe('Hello')
      expect(getOption<number>(interaction, 'count')).toBe(5)
    })

    it('should return undefined for missing option', () => {
      const interaction = { data: { options: [] } }
      expect(getOption(interaction, 'missing')).toBeUndefined()
    })

    it('should get option from subcommand', () => {
      const interaction = {
        data: {
          options: [{
            name: 'sub',
            type: 1,
            options: [{ name: 'arg', value: 'test' }]
          }]
        }
      }

      expect(getOption(interaction, 'arg', 'sub')).toBe('test')
    })
  })

  describe('getOptions', () => {
    it('should get all options as object', () => {
      const interaction = {
        data: {
          options: [
            { name: 'a', value: 1 },
            { name: 'b', value: 'two' },
            { name: 'c', value: true },
          ]
        }
      }

      const options = getOptions(interaction)
      expect(options).toEqual({ a: 1, b: 'two', c: true })
    })

    it('should return empty object for no options', () => {
      expect(getOptions({ data: {} })).toEqual({})
      expect(getOptions({})).toEqual({})
    })
  })

  describe('getSubcommand', () => {
    it('should get subcommand name', () => {
      const interaction = {
        data: {
          options: [{
            name: 'settings',
            type: ApplicationCommandOptionType.SubCommand,
          }]
        }
      }

      expect(getSubcommand(interaction)).toBe('settings')
    })

    it('should return undefined if no subcommand', () => {
      const interaction = {
        data: {
          options: [{ name: 'arg', type: ApplicationCommandOptionType.String }]
        }
      }

      expect(getSubcommand(interaction)).toBeUndefined()
    })
  })

  describe('getSubcommandGroup', () => {
    it('should get subcommand group name', () => {
      const interaction = {
        data: {
          options: [{
            name: 'admin',
            type: ApplicationCommandOptionType.SubCommandGroup,
          }]
        }
      }

      expect(getSubcommandGroup(interaction)).toBe('admin')
    })

    it('should return undefined if no group', () => {
      expect(getSubcommandGroup({ data: { options: [] } })).toBeUndefined()
    })
  })

  describe('getInteractionUser', () => {
    it('should get user from user field', () => {
      const interaction = {
        user: { id: '123', username: 'Test' }
      }

      expect(getInteractionUser(interaction)?.id).toBe('123')
    })

    it('should get user from member field', () => {
      const interaction = {
        member: {
          user: { id: '456', username: 'Member' }
        }
      }

      expect(getInteractionUser(interaction)?.id).toBe('456')
    })

    it('should prefer user over member', () => {
      const interaction = {
        user: { id: '123', username: 'User' },
        member: {
          user: { id: '456', username: 'Member' }
        }
      }

      expect(getInteractionUser(interaction)?.id).toBe('123')
    })
  })

  describe('getSelectedValues', () => {
    it('should get select menu values', () => {
      const interaction = {
        data: { values: ['option1', 'option2'] }
      }

      expect(getSelectedValues(interaction)).toEqual(['option1', 'option2'])
    })

    it('should return empty array if no values', () => {
      expect(getSelectedValues({ data: {} })).toEqual([])
      expect(getSelectedValues({})).toEqual([])
    })
  })

  describe('getModalValues', () => {
    it('should get modal input values', () => {
      const interaction = {
        data: {
          components: [
            {
              components: [
                { custom_id: 'name', value: 'John' }
              ]
            },
            {
              components: [
                { custom_id: 'email', value: 'john@example.com' }
              ]
            }
          ]
        }
      }

      const values = getModalValues(interaction)
      expect(values).toEqual({
        name: 'John',
        email: 'john@example.com'
      })
    })

    it('should return empty object for no components', () => {
      expect(getModalValues({ data: {} })).toEqual({})
      expect(getModalValues({})).toEqual({})
    })
  })
})

describe('Response Factories', () => {
  describe('createPongResponse', () => {
    it('should create pong response', () => {
      const response = createPongResponse()
      expect(response.type).toBe(InteractionResponseType.Pong)
    })
  })

  describe('createMessageResponse', () => {
    it('should create message response from string', () => {
      const response = createMessageResponse('Hello!')
      expect(response.type).toBe(InteractionResponseType.ChannelMessageWithSource)
      expect(response.data.content).toBe('Hello!')
    })

    it('should create message response from object', () => {
      const response = createMessageResponse({
        content: 'Hello!',
        embeds: [{ title: 'Test' }]
      })
      expect(response.type).toBe(InteractionResponseType.ChannelMessageWithSource)
      expect(response.data.embeds).toHaveLength(1)
    })
  })

  describe('createDeferredResponse', () => {
    it('should create deferred response', () => {
      const response = createDeferredResponse()
      expect(response.type).toBe(InteractionResponseType.DeferredChannelMessageWithSource)
      expect(response.data).toBeUndefined()
    })

    it('should create ephemeral deferred response', () => {
      const response = createDeferredResponse(true)
      expect(response.type).toBe(InteractionResponseType.DeferredChannelMessageWithSource)
      expect(response.data?.flags).toBe(64)
    })
  })

  describe('createDeferredUpdateResponse', () => {
    it('should create deferred update response', () => {
      const response = createDeferredUpdateResponse()
      expect(response.type).toBe(InteractionResponseType.DeferredUpdateMessage)
    })
  })

  describe('createUpdateResponse', () => {
    it('should create update response from string', () => {
      const response = createUpdateResponse('Updated!')
      expect(response.type).toBe(InteractionResponseType.UpdateMessage)
      expect(response.data.content).toBe('Updated!')
    })

    it('should create update response from object', () => {
      const response = createUpdateResponse({ content: 'Updated!' })
      expect(response.type).toBe(InteractionResponseType.UpdateMessage)
    })
  })

  describe('createModalResponse', () => {
    it('should create modal response', () => {
      const response = createModalResponse({
        custom_id: 'my-modal',
        title: 'Test Modal',
        components: []
      })
      expect(response.type).toBe(InteractionResponseType.Modal)
      expect(response.data.custom_id).toBe('my-modal')
      expect(response.data.title).toBe('Test Modal')
    })
  })

  describe('createAutocompleteResponse', () => {
    it('should create autocomplete response', () => {
      const choices = [
        { name: 'Option 1', value: 'opt1' },
        { name: 'Option 2', value: 'opt2' }
      ]
      const response = createAutocompleteResponse(choices)
      expect(response.type).toBe(InteractionResponseType.ApplicationCommandAutocompleteResult)
      expect(response.data.choices).toEqual(choices)
    })
  })
})

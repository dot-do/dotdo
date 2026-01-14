/**
 * @dotdo/discord - Messages Module Tests
 */
import { describe, it, expect } from 'vitest'

import {
  MessagePayload,
  MessageEditPayload,
  createTextMessage,
  createEmbedMessage,
  createReply,
  createEphemeralMessage,
  MessageFlags,
} from '../messages'

describe('MessagePayload', () => {
  it('should build basic message payload', () => {
    const payload = new MessagePayload()
      .setContent('Hello, World!')

    const json = payload.toJSON()
    expect(json.content).toBe('Hello, World!')
  })

  it('should build message with embeds', () => {
    const payload = new MessagePayload()
      .setContent('Check this out!')
      .setEmbeds([{ title: 'Test', description: 'Description' }])

    const json = payload.toJSON()
    expect(json.content).toBe('Check this out!')
    expect(json.embeds).toHaveLength(1)
    expect(json.embeds![0].title).toBe('Test')
  })

  it('should add embeds incrementally', () => {
    const payload = new MessagePayload()
      .addEmbeds({ title: 'First' })
      .addEmbeds({ title: 'Second' }, { title: 'Third' })

    const json = payload.toJSON()
    expect(json.embeds).toHaveLength(3)
  })

  it('should build message with components', () => {
    const payload = new MessagePayload()
      .setContent('Interactive!')
      .setComponents([{
        type: 1,
        components: [{ type: 2, custom_id: 'btn', label: 'Click' }]
      }])

    const json = payload.toJSON()
    expect(json.components).toHaveLength(1)
  })

  it('should add components incrementally', () => {
    const payload = new MessagePayload()
      .addComponents({ type: 1, components: [] })
      .addComponents({ type: 1, components: [] })

    const json = payload.toJSON()
    expect(json.components).toHaveLength(2)
  })

  it('should set TTS', () => {
    const payload = new MessagePayload()
      .setContent('Hello!')
      .setTTS(true)

    const json = payload.toJSON()
    expect(json.tts).toBe(true)
  })

  it('should set flags', () => {
    const payload = new MessagePayload()
      .setContent('Test')
      .setFlags(64)

    const json = payload.toJSON()
    expect(json.flags).toBe(64)
  })

  it('should set ephemeral', () => {
    const payload = new MessagePayload()
      .setContent('Secret')
      .setEphemeral()

    const json = payload.toJSON()
    expect(json.flags! & MessageFlags.Ephemeral).toBe(MessageFlags.Ephemeral)
  })

  it('should unset ephemeral', () => {
    const payload = new MessagePayload()
      .setFlags(64)
      .setEphemeral(false)

    const json = payload.toJSON()
    expect(json.flags! & 64).toBe(0)
  })

  it('should set suppress embeds', () => {
    const payload = new MessagePayload()
      .setContent('Link: https://example.com')
      .setSuppressEmbeds()

    const json = payload.toJSON()
    expect(json.flags! & MessageFlags.SuppressEmbeds).toBe(MessageFlags.SuppressEmbeds)
  })

  it('should set allowed mentions', () => {
    const payload = new MessagePayload()
      .setContent('@everyone')
      .setAllowedMentions({ parse: ['users'], replied_user: false })

    const json = payload.toJSON()
    expect(json.allowed_mentions?.parse).toContain('users')
    expect(json.allowed_mentions?.replied_user).toBe(false)
  })

  it('should set message reference', () => {
    const payload = new MessagePayload()
      .setContent('Reply!')
      .setReference({ message_id: '123', channel_id: '456' })

    const json = payload.toJSON()
    expect(json.message_reference?.message_id).toBe('123')
    expect(json.message_reference?.channel_id).toBe('456')
  })

  it('should use replyTo helper', () => {
    const payload = new MessagePayload()
      .setContent('Reply!')
      .replyTo('123456789')

    const json = payload.toJSON()
    expect(json.message_reference?.message_id).toBe('123456789')
    expect(json.message_reference?.fail_if_not_exists).toBe(true)
  })

  it('should use replyTo with fail_if_not_exists false', () => {
    const payload = new MessagePayload()
      .replyTo('123', false)

    const json = payload.toJSON()
    expect(json.message_reference?.fail_if_not_exists).toBe(false)
  })

  it('should set sticker IDs', () => {
    const payload = new MessagePayload()
      .setStickerIds(['sticker1', 'sticker2'])

    const json = payload.toJSON()
    expect(json.sticker_ids).toEqual(['sticker1', 'sticker2'])
  })

  it('should set attachments', () => {
    const payload = new MessagePayload()
      .setAttachments([
        { id: 0, filename: 'file.txt' },
        { id: 1, filename: 'image.png', description: 'An image' }
      ])

    const json = payload.toJSON()
    expect(json.attachments).toHaveLength(2)
  })
})

describe('MessageEditPayload', () => {
  it('should build edit payload', () => {
    const payload = new MessageEditPayload()
      .setContent('Updated content')

    const json = payload.toJSON()
    expect(json.content).toBe('Updated content')
  })

  it('should clear content', () => {
    const payload = new MessageEditPayload()
      .clearContent()

    const json = payload.toJSON()
    expect(json.content).toBeNull()
  })

  it('should set embeds', () => {
    const payload = new MessageEditPayload()
      .setEmbeds([{ title: 'New embed' }])

    const json = payload.toJSON()
    expect(json.embeds).toHaveLength(1)
  })

  it('should clear embeds', () => {
    const payload = new MessageEditPayload()
      .clearEmbeds()

    const json = payload.toJSON()
    expect(json.embeds).toBeNull()
  })

  it('should set components', () => {
    const payload = new MessageEditPayload()
      .setComponents([{ type: 1, components: [] }])

    const json = payload.toJSON()
    expect(json.components).toHaveLength(1)
  })

  it('should clear components', () => {
    const payload = new MessageEditPayload()
      .clearComponents()

    const json = payload.toJSON()
    expect(json.components).toBeNull()
  })

  it('should set flags', () => {
    const payload = new MessageEditPayload()
      .setFlags(4)

    const json = payload.toJSON()
    expect(json.flags).toBe(4)
  })

  it('should set allowed mentions', () => {
    const payload = new MessageEditPayload()
      .setAllowedMentions({ parse: [] })

    const json = payload.toJSON()
    expect(json.allowed_mentions?.parse).toEqual([])
  })

  it('should set attachments', () => {
    const payload = new MessageEditPayload()
      .setAttachments([{ id: 0 }])

    const json = payload.toJSON()
    expect(json.attachments).toHaveLength(1)
  })
})

describe('Helper Functions', () => {
  describe('createTextMessage', () => {
    it('should create simple text message', () => {
      const payload = createTextMessage('Hello!')
      expect(payload.content).toBe('Hello!')
    })
  })

  describe('createEmbedMessage', () => {
    it('should create embed message', () => {
      const payload = createEmbedMessage([{ title: 'Test' }])
      expect(payload.embeds).toHaveLength(1)
      expect(payload.content).toBeUndefined()
    })

    it('should create embed message with content', () => {
      const payload = createEmbedMessage([{ title: 'Test' }], 'Hello!')
      expect(payload.embeds).toHaveLength(1)
      expect(payload.content).toBe('Hello!')
    })
  })

  describe('createReply', () => {
    it('should create reply message', () => {
      const payload = createReply('msg123', 'Reply content')
      expect(payload.content).toBe('Reply content')
      expect(payload.message_reference?.message_id).toBe('msg123')
    })

    it('should create reply with additional options', () => {
      const payload = createReply('msg123', 'Reply', { tts: true })
      expect(payload.tts).toBe(true)
    })
  })

  describe('createEphemeralMessage', () => {
    it('should create ephemeral message', () => {
      const payload = createEphemeralMessage('Secret message')
      expect(payload.content).toBe('Secret message')
      expect(payload.flags).toBe(MessageFlags.Ephemeral)
    })

    it('should create ephemeral message with options', () => {
      const payload = createEphemeralMessage('Secret', {
        embeds: [{ title: 'Private' }]
      })
      expect(payload.embeds).toHaveLength(1)
      expect(payload.flags).toBe(MessageFlags.Ephemeral)
    })
  })
})

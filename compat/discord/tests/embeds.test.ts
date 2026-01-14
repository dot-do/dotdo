/**
 * @dotdo/discord - Embeds Module Tests
 */
import { describe, it, expect } from 'vitest'

import {
  EmbedBuilder,
  EmbedColors,
  EmbedLimits,
  createSimpleEmbed,
  createErrorEmbed,
  createSuccessEmbed,
  createWarningEmbed,
  createInfoEmbed,
  calculateEmbedLength,
  validateEmbed,
} from '../embeds'

describe('EmbedColors', () => {
  it('should have correct brand colors', () => {
    expect(EmbedColors.Default).toBe(0x000000)
    expect(EmbedColors.White).toBe(0xffffff)
    expect(EmbedColors.Blurple).toBe(0x5865f2)
    expect(EmbedColors.Red).toBe(0xed4245)
    expect(EmbedColors.Green).toBe(0x57f287)
    expect(EmbedColors.Blue).toBe(0x3498db)
  })

  it('should have correct status colors', () => {
    expect(EmbedColors.Online).toBe(0x43b581)
    expect(EmbedColors.Idle).toBe(0xfaa61a)
    expect(EmbedColors.DND).toBe(0xf04747)
    expect(EmbedColors.Offline).toBe(0x747f8d)
  })

  it('should have correct semantic colors', () => {
    expect(EmbedColors.Success).toBe(0x57f287)
    expect(EmbedColors.Warning).toBe(0xfee75c)
    expect(EmbedColors.Error).toBe(0xed4245)
    expect(EmbedColors.Info).toBe(0x3498db)
  })
})

describe('EmbedLimits', () => {
  it('should have correct limits', () => {
    expect(EmbedLimits.Title).toBe(256)
    expect(EmbedLimits.Description).toBe(4096)
    expect(EmbedLimits.Fields).toBe(25)
    expect(EmbedLimits.FieldName).toBe(256)
    expect(EmbedLimits.FieldValue).toBe(1024)
    expect(EmbedLimits.FooterText).toBe(2048)
    expect(EmbedLimits.AuthorName).toBe(256)
    expect(EmbedLimits.Total).toBe(6000)
    expect(EmbedLimits.PerMessage).toBe(10)
  })
})

describe('EmbedBuilder (re-exported)', () => {
  it('should create basic embed', () => {
    const embed = new EmbedBuilder()
      .setTitle('Test')
      .setDescription('Description')

    const json = embed.toJSON()
    expect(json.title).toBe('Test')
    expect(json.description).toBe('Description')
  })

  it('should set color', () => {
    const embed = new EmbedBuilder().setColor(EmbedColors.Success)

    const json = embed.toJSON()
    expect(json.color).toBe(EmbedColors.Success)
  })
})

describe('calculateEmbedLength', () => {
  it('should calculate simple embed length', () => {
    const length = calculateEmbedLength({
      title: 'Hello',
      description: 'World',
    })
    expect(length).toBe(10) // 5 + 5
  })

  it('should calculate embed with all parts', () => {
    const length = calculateEmbedLength({
      title: '12345',
      description: '12345',
      footer: { text: '12345' },
      author: { name: '12345' },
      fields: [
        { name: '12345', value: '12345' },
        { name: '12345', value: '12345' },
      ],
    })
    expect(length).toBe(40) // 5 + 5 + 5 + 5 + (5+5)*2
  })

  it('should handle empty embed', () => {
    const length = calculateEmbedLength({})
    expect(length).toBe(0)
  })

  it('should handle embed with only fields', () => {
    const length = calculateEmbedLength({
      fields: [
        { name: 'Name', value: 'Value' },
      ],
    })
    expect(length).toBe(9) // 4 + 5
  })
})

describe('validateEmbed', () => {
  it('should validate valid embed', () => {
    const result = validateEmbed({
      title: 'Valid Title',
      description: 'Valid description',
    })
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('should catch title too long', () => {
    const result = validateEmbed({
      title: 'a'.repeat(300),
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain(`Title exceeds ${EmbedLimits.Title} characters`)
  })

  it('should catch description too long', () => {
    const result = validateEmbed({
      description: 'a'.repeat(5000),
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain(`Description exceeds ${EmbedLimits.Description} characters`)
  })

  it('should catch footer too long', () => {
    const result = validateEmbed({
      footer: { text: 'a'.repeat(3000) },
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain(`Footer text exceeds ${EmbedLimits.FooterText} characters`)
  })

  it('should catch author name too long', () => {
    const result = validateEmbed({
      author: { name: 'a'.repeat(300) },
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain(`Author name exceeds ${EmbedLimits.AuthorName} characters`)
  })

  it('should catch too many fields', () => {
    const result = validateEmbed({
      fields: Array(30).fill({ name: 'N', value: 'V' }),
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain(`Number of fields exceeds ${EmbedLimits.Fields}`)
  })

  it('should catch field name too long', () => {
    const result = validateEmbed({
      fields: [{ name: 'a'.repeat(300), value: 'V' }],
    })
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('Field 1 name exceeds')
  })

  it('should catch field value too long', () => {
    const result = validateEmbed({
      fields: [{ name: 'N', value: 'a'.repeat(2000) }],
    })
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('Field 1 value exceeds')
  })

  it('should catch total length too long', () => {
    const result = validateEmbed({
      description: 'a'.repeat(4000),
      footer: { text: 'b'.repeat(2000) },
      author: { name: 'c'.repeat(100) },
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('Total embed length'))).toBe(true)
  })

  it('should report multiple errors', () => {
    const result = validateEmbed({
      title: 'a'.repeat(300),
      description: 'b'.repeat(5000),
    })
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(1)
  })
})

describe('Helper Functions', () => {
  describe('createSimpleEmbed', () => {
    it('should create embed with title and description', () => {
      const embed = createSimpleEmbed('Title', 'Description')
      const json = embed.toJSON()
      expect(json.title).toBe('Title')
      expect(json.description).toBe('Description')
    })

    it('should create embed with color', () => {
      const embed = createSimpleEmbed('Title', 'Description', 0xff0000)
      const json = embed.toJSON()
      expect(json.color).toBe(0xff0000)
    })
  })

  describe('createErrorEmbed', () => {
    it('should create red embed', () => {
      const embed = createErrorEmbed('Error', 'Something went wrong')
      const json = embed.toJSON()
      expect(json.title).toBe('Error')
      expect(json.description).toBe('Something went wrong')
      expect(json.color).toBe(EmbedColors.Error)
    })
  })

  describe('createSuccessEmbed', () => {
    it('should create green embed', () => {
      const embed = createSuccessEmbed('Success', 'Operation completed')
      const json = embed.toJSON()
      expect(json.title).toBe('Success')
      expect(json.color).toBe(EmbedColors.Success)
    })
  })

  describe('createWarningEmbed', () => {
    it('should create yellow embed', () => {
      const embed = createWarningEmbed('Warning', 'Be careful')
      const json = embed.toJSON()
      expect(json.title).toBe('Warning')
      expect(json.color).toBe(EmbedColors.Warning)
    })
  })

  describe('createInfoEmbed', () => {
    it('should create blue embed', () => {
      const embed = createInfoEmbed('Info', 'Just so you know')
      const json = embed.toJSON()
      expect(json.title).toBe('Info')
      expect(json.color).toBe(EmbedColors.Info)
    })
  })
})

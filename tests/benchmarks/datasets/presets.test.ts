import { describe, test, expect } from 'vitest'
import { getPreset, PRESET_SIZES } from './presets'
import { DocumentGenerator } from './documents'

describe('Dataset Presets', () => {
  test('small preset produces 100 records', async () => {
    const gen = new DocumentGenerator()
    const preset = getPreset('small')
    const docs = gen.generateSync({ ...preset })

    expect(docs.length).toBe(100)
  })

  test('medium preset produces 10,000 records', async () => {
    const gen = new DocumentGenerator()
    const preset = getPreset('medium')
    const docs: any[] = []

    for await (const doc of gen.generate(preset)) {
      docs.push(doc)
    }

    expect(docs.length).toBe(10_000)
  })

  test('large preset produces 1,000,000 records', async () => {
    // This test verifies the config, not actually generating 1M records
    const preset = getPreset('large')
    expect(preset.size).toBe(1_000_000)
  })

  test('presets are properly defined', () => {
    expect(PRESET_SIZES.small).toBe(100)
    expect(PRESET_SIZES.medium).toBe(10_000)
    expect(PRESET_SIZES.large).toBe(1_000_000)
  })

  test('getPreset returns correct size', () => {
    expect(getPreset('small').size).toBe(100)
    expect(getPreset('medium').size).toBe(10_000)
    expect(getPreset('large').size).toBe(1_000_000)
  })
})

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadConfig, getConfigPath, configExists, writeConfig } from '../utils/do-config'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

describe('do-config loader', () => {
  const testDir = '/tmp/dotdo-config-test'

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('returns null when no config exists', async () => {
    const config = await loadConfig(testDir)
    expect(config).toBeNull()
  })

  it('loads do.config.ts with $id', async () => {
    const configContent = `export default { $id: 'https://test.example.com' }`
    writeFileSync(join(testDir, 'do.config.ts'), configContent)

    const config = await loadConfig(testDir)
    expect(config?.$id).toBe('https://test.example.com')
  })

  it('getConfigPath returns correct path', () => {
    const path = getConfigPath(testDir)
    expect(path).toBe(join(testDir, 'do.config.ts'))
  })

  it('configExists returns false for missing config', () => {
    expect(configExists(testDir)).toBe(false)
  })

  it('configExists returns true when config exists', () => {
    writeFileSync(join(testDir, 'do.config.ts'), 'export default {}')
    expect(configExists(testDir)).toBe(true)
  })
})

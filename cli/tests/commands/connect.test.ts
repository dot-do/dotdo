import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { connectToDO } from '../../commands/connect'
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'

describe('connect command', () => {
  const testDir = '/tmp/dotdo-connect-test'

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('creates do.config.ts with $id', async () => {
    await connectToDO({
      $id: 'https://test.example.com',
      dir: testDir,
      skipTypes: true
    })

    const configPath = join(testDir, 'do.config.ts')
    expect(existsSync(configPath)).toBe(true)

    const content = readFileSync(configPath, 'utf-8')
    expect(content).toContain('https://test.example.com')
  })

  it('includes proper type import in config file', async () => {
    await connectToDO({
      $id: 'https://my-do.workers.do',
      dir: testDir,
      skipTypes: true
    })

    const configPath = join(testDir, 'do.config.ts')
    const content = readFileSync(configPath, 'utf-8')
    expect(content).toContain("import type { DO } from 'dotdo'")
    expect(content).toContain('satisfies DO.Config')
  })

  it('does not overwrite existing config without force flag', async () => {
    // Create initial config
    await connectToDO({
      $id: 'https://first.example.com',
      dir: testDir,
      skipTypes: true
    })

    // Try to connect again without force
    await connectToDO({
      $id: 'https://second.example.com',
      dir: testDir,
      skipTypes: true,
      force: false
    })

    // Should still have original config
    const content = readFileSync(join(testDir, 'do.config.ts'), 'utf-8')
    expect(content).toContain('https://first.example.com')
    expect(content).not.toContain('https://second.example.com')
  })

  it('overwrites existing config with force flag', async () => {
    // Create initial config
    await connectToDO({
      $id: 'https://first.example.com',
      dir: testDir,
      skipTypes: true
    })

    // Connect again with force
    await connectToDO({
      $id: 'https://second.example.com',
      dir: testDir,
      skipTypes: true,
      force: true
    })

    // Should have new config
    const content = readFileSync(join(testDir, 'do.config.ts'), 'utf-8')
    expect(content).toContain('https://second.example.com')
    expect(content).not.toContain('https://first.example.com')
  })

  it('generates types when skipTypes is false', async () => {
    await connectToDO({
      $id: 'https://test.example.com',
      dir: testDir,
      skipTypes: false
    })

    // Check types file was created
    const typesPath = join(testDir, '.do', 'types.d.ts')
    expect(existsSync(typesPath)).toBe(true)
  })

  it('does not generate types when skipTypes is true', async () => {
    await connectToDO({
      $id: 'https://test.example.com',
      dir: testDir,
      skipTypes: true
    })

    // Check types file was NOT created
    const typesPath = join(testDir, '.do', 'types.d.ts')
    expect(existsSync(typesPath)).toBe(false)
  })
})

describe('connectCommand', () => {
  it('exports Commander command', async () => {
    const { connectCommand } = await import('../../commands/connect')

    expect(connectCommand).toBeDefined()
    expect(connectCommand.name()).toBe('connect')
    expect(connectCommand.description()).toContain('Connect')
  })
})

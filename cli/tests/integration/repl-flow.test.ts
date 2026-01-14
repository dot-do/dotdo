/**
 * REPL Integration Flow Tests
 *
 * Tests the complete flow of the mongosh-style REPL CLI:
 * connect -> config -> types
 *
 * Note: Tests use unique directories because Bun caches dynamic imports.
 * The loadConfig function uses `await import(configPath)` which gets cached.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { connectToDO } from '../../commands/connect'
import { loadConfig, configExists, writeConfig } from '../../utils/do-config'
import { generateTypes } from '../../commands/generate'

// Use unique directories to avoid Bun's module cache issues
const baseTestDir = '/tmp/dotdo-integration-test'
let testCounter = 0

function getUniqueTestDir(): string {
  testCounter++
  const dir = `${baseTestDir}-${testCounter}-${Date.now()}`
  mkdirSync(dir, { recursive: true })
  return dir
}

describe('REPL integration flow', () => {
  const dirsToCleanup: string[] = []

  afterAll(() => {
    // Cleanup all test directories
    for (const dir of dirsToCleanup) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('complete flow: connect -> config -> types', async () => {
    const testDir = getUniqueTestDir()
    dirsToCleanup.push(testDir)

    // 1. Connect to DO
    await connectToDO({
      $id: 'https://test.example.com',
      dir: testDir,
      skipTypes: true
    })

    // 2. Verify config created
    const config = await loadConfig(testDir)
    expect(config).not.toBeNull()
    expect(config?.$id).toBe('https://test.example.com')

    // 3. Generate types
    await generateTypes({
      $id: config!.$id,
      outputDir: testDir,
      mockTypes: true
    })

    // 4. Verify types created
    expect(existsSync(join(testDir, '.do', 'types.d.ts'))).toBe(true)
  })

  it('connect with types generation creates both files', async () => {
    const testDir = getUniqueTestDir()
    dirsToCleanup.push(testDir)

    // Connect without skipTypes (default behavior)
    await connectToDO({
      $id: 'https://full-flow.example.com',
      dir: testDir,
      skipTypes: false
    })

    // Both config and types should be created
    expect(existsSync(join(testDir, 'do.config.ts'))).toBe(true)
    expect(existsSync(join(testDir, '.do', 'types.d.ts'))).toBe(true)

    // Verify config content
    const config = await loadConfig(testDir)
    expect(config?.$id).toBe('https://full-flow.example.com')

    // Verify types content includes the $id
    const typesContent = readFileSync(join(testDir, '.do', 'types.d.ts'), 'utf-8')
    expect(typesContent).toContain('https://full-flow.example.com')
  })

  it('connect respects force flag - does not overwrite without force', async () => {
    const testDir = getUniqueTestDir()
    dirsToCleanup.push(testDir)

    // First connection
    await connectToDO({
      $id: 'https://original.example.com',
      dir: testDir,
      skipTypes: true
    })

    // Verify original config by reading file directly (avoids cache)
    const configContent = readFileSync(join(testDir, 'do.config.ts'), 'utf-8')
    expect(configContent).toContain('https://original.example.com')

    // Second connection without force - should NOT overwrite
    await connectToDO({
      $id: 'https://new.example.com',
      dir: testDir,
      skipTypes: true,
      force: false
    })

    // Config should still have original URL
    const configContentAfter = readFileSync(join(testDir, 'do.config.ts'), 'utf-8')
    expect(configContentAfter).toContain('https://original.example.com')
    expect(configContentAfter).not.toContain('https://new.example.com')
  })

  it('connect respects force flag - overwrites with force', async () => {
    const testDir = getUniqueTestDir()
    dirsToCleanup.push(testDir)

    // First connection
    await connectToDO({
      $id: 'https://original.example.com',
      dir: testDir,
      skipTypes: true
    })

    // Connection with force - SHOULD overwrite
    await connectToDO({
      $id: 'https://forced.example.com',
      dir: testDir,
      skipTypes: true,
      force: true
    })

    // Config should have new URL (read file directly to avoid cache)
    const configContent = readFileSync(join(testDir, 'do.config.ts'), 'utf-8')
    expect(configContent).toContain('https://forced.example.com')
    expect(configContent).not.toContain('https://original.example.com')
  })

  it('rejects invalid URLs', async () => {
    const testDir = getUniqueTestDir()
    dirsToCleanup.push(testDir)

    await expect(
      connectToDO({
        $id: 'not-a-valid-url',
        dir: testDir,
        skipTypes: true
      })
    ).rejects.toThrow('Invalid DO URL')

    // No config should be created
    expect(configExists(testDir)).toBe(false)
  })

  it('rejects empty URL', async () => {
    const testDir = getUniqueTestDir()
    dirsToCleanup.push(testDir)

    await expect(
      connectToDO({
        $id: '',
        dir: testDir,
        skipTypes: true
      })
    ).rejects.toThrow('Invalid DO URL')

    expect(configExists(testDir)).toBe(false)
  })

  it('handles URL with path', async () => {
    const testDir = getUniqueTestDir()
    dirsToCleanup.push(testDir)

    await connectToDO({
      $id: 'https://api.workers.do/tenant/my-do',
      dir: testDir,
      skipTypes: true
    })

    const config = await loadConfig(testDir)
    expect(config?.$id).toBe('https://api.workers.do/tenant/my-do')
  })

  it('handles URL with port', async () => {
    const testDir = getUniqueTestDir()
    dirsToCleanup.push(testDir)

    await connectToDO({
      $id: 'http://localhost:8787',
      dir: testDir,
      skipTypes: true
    })

    const config = await loadConfig(testDir)
    expect(config?.$id).toBe('http://localhost:8787')
  })

  it('preserves existing .do directory contents when generating types', async () => {
    const testDir = getUniqueTestDir()
    dirsToCleanup.push(testDir)

    // Create .do directory with existing file
    const doDir = join(testDir, '.do')
    mkdirSync(doDir, { recursive: true })
    const existingFile = join(doDir, 'custom.json')
    writeFileSync(existingFile, '{"custom": true}', 'utf-8')

    // Connect and generate types
    await connectToDO({
      $id: 'https://test.example.com',
      dir: testDir,
      skipTypes: false
    })

    // Existing file should still be there
    expect(existsSync(existingFile)).toBe(true)
    expect(readFileSync(existingFile, 'utf-8')).toBe('{"custom": true}')

    // Types should also exist
    expect(existsSync(join(doDir, 'types.d.ts'))).toBe(true)
  })

  it('types file includes DO module declaration', async () => {
    const testDir = getUniqueTestDir()
    dirsToCleanup.push(testDir)

    await connectToDO({
      $id: 'https://typed.example.com',
      dir: testDir,
      skipTypes: false
    })

    const typesContent = readFileSync(join(testDir, '.do', 'types.d.ts'), 'utf-8')

    // Should include module declaration
    expect(typesContent).toContain("declare module 'dotdo'")
    expect(typesContent).toContain('namespace DO')
    expect(typesContent).toContain('interface Config')
    expect(typesContent).toContain('$id: string')
  })

  it('config file includes proper TypeScript structure', async () => {
    const testDir = getUniqueTestDir()
    dirsToCleanup.push(testDir)

    await connectToDO({
      $id: 'https://typescript.example.com',
      dir: testDir,
      skipTypes: true
    })

    const configContent = readFileSync(join(testDir, 'do.config.ts'), 'utf-8')

    // Should have proper TypeScript imports and structure
    expect(configContent).toContain("import type { DO } from 'dotdo'")
    expect(configContent).toContain('export default')
    expect(configContent).toContain('satisfies DO.Config')
  })

  it('regenerate types updates existing types file', async () => {
    const testDir = getUniqueTestDir()
    dirsToCleanup.push(testDir)

    // Initial connect
    await connectToDO({
      $id: 'https://first.example.com',
      dir: testDir,
      skipTypes: false
    })

    let typesContent = readFileSync(join(testDir, '.do', 'types.d.ts'), 'utf-8')
    expect(typesContent).toContain('https://first.example.com')

    // Regenerate with different URL (simulating reconnect scenario)
    await generateTypes({
      $id: 'https://second.example.com',
      outputDir: testDir,
      mockTypes: true
    })

    typesContent = readFileSync(join(testDir, '.do', 'types.d.ts'), 'utf-8')
    expect(typesContent).toContain('https://second.example.com')
    expect(typesContent).not.toContain('https://first.example.com')
  })

  it('writeConfig and loadConfig roundtrip', async () => {
    const testDir = getUniqueTestDir()
    dirsToCleanup.push(testDir)

    const originalConfig = {
      $id: 'https://roundtrip.example.com'
    }

    await writeConfig(originalConfig, testDir)
    const loadedConfig = await loadConfig(testDir)

    expect(loadedConfig).not.toBeNull()
    expect(loadedConfig?.$id).toBe(originalConfig.$id)
  })

  it('multiple sequential connects with force flag', async () => {
    const urls = [
      'https://first.example.com',
      'https://second.example.com',
      'https://third.example.com'
    ]

    for (const url of urls) {
      // Use unique dir for each to avoid cache issues
      const testDir = getUniqueTestDir()
      dirsToCleanup.push(testDir)

      await connectToDO({
        $id: url,
        dir: testDir,
        skipTypes: true,
        force: true
      })

      const config = await loadConfig(testDir)
      expect(config?.$id).toBe(url)
    }
  })

  it('handles various URL schemes', async () => {
    const validUrls = [
      'https://secure.example.com',
      'http://insecure.example.com',
      'http://localhost:8787',
      'https://subdomain.api.workers.do'
    ]

    for (const url of validUrls) {
      // Use unique dir for each to avoid cache issues
      const testDir = getUniqueTestDir()
      dirsToCleanup.push(testDir)

      await connectToDO({
        $id: url,
        dir: testDir,
        skipTypes: true
      })

      const config = await loadConfig(testDir)
      expect(config?.$id).toBe(url)
    }
  })
})

describe('error handling in REPL flow', () => {
  const dirsToCleanup: string[] = []

  afterAll(() => {
    for (const dir of dirsToCleanup) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('loadConfig returns null for non-existent directory', async () => {
    const nonExistentDir = '/tmp/dotdo-non-existent-dir-12345'
    const config = await loadConfig(nonExistentDir)
    expect(config).toBeNull()
  })

  it('generateTypes creates directory if not exists', async () => {
    const testDir = getUniqueTestDir()
    dirsToCleanup.push(testDir)
    const nestedDir = join(testDir, 'nested', 'deep', 'dir')

    await generateTypes({
      $id: 'https://nested.example.com',
      outputDir: nestedDir,
      mockTypes: true
    })

    expect(existsSync(join(nestedDir, '.do', 'types.d.ts'))).toBe(true)
  })

  it('generateTypes works with localhost URLs', async () => {
    const testDir = getUniqueTestDir()
    dirsToCleanup.push(testDir)

    await generateTypes({
      $id: 'http://localhost:8787',
      outputDir: testDir,
      mockTypes: true
    })

    const typesContent = readFileSync(join(testDir, '.do', 'types.d.ts'), 'utf-8')
    expect(typesContent).toContain('http://localhost:8787')
  })
})

describe('config file validation', () => {
  const dirsToCleanup: string[] = []

  afterAll(() => {
    for (const dir of dirsToCleanup) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('configExists returns false for empty directory', () => {
    const testDir = getUniqueTestDir()
    dirsToCleanup.push(testDir)

    expect(configExists(testDir)).toBe(false)
  })

  it('configExists returns true after connect', async () => {
    const testDir = getUniqueTestDir()
    dirsToCleanup.push(testDir)

    expect(configExists(testDir)).toBe(false)

    await connectToDO({
      $id: 'https://config-exists.example.com',
      dir: testDir,
      skipTypes: true
    })

    expect(configExists(testDir)).toBe(true)
  })

  it('config file is valid TypeScript', async () => {
    const testDir = getUniqueTestDir()
    dirsToCleanup.push(testDir)

    await connectToDO({
      $id: 'https://valid-ts.example.com',
      dir: testDir,
      skipTypes: true
    })

    const configContent = readFileSync(join(testDir, 'do.config.ts'), 'utf-8')

    // Verify structure
    expect(configContent).toMatch(/^import type \{ DO \} from 'dotdo'/)
    expect(configContent).toContain('export default {')
    expect(configContent).toContain("$id: 'https://valid-ts.example.com'")
    expect(configContent).toContain('} satisfies DO.Config')
  })
})

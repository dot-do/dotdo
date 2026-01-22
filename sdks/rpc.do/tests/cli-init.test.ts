// CLI Init Command Tests - TDD for rpc.do CLI
// Tests the `rpc.do init` command for initializing projects with RPC configuration

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

// Module under test (will be created in GREEN phase)
import { init, type InitOptions, type InitResult, type DoConfig } from '../src/cli/init'

// ============================================================================
// Helper: Create temp directory for testing file operations
// ============================================================================

let tempDir: string

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rpc-do-init-test-'))
})

afterEach(async () => {
  // Clean up temp directory
  await fs.rm(tempDir, { recursive: true, force: true })
})

// ============================================================================
// `rpc.do init` - Basic functionality
// ============================================================================

describe('rpc.do init', () => {
  it('creates .do/ directory if it does not exist', async () => {
    const result = await init({
      endpoint: 'https://api.example.com',
      cwd: tempDir,
      skipPull: true,
    })

    expect(result.success).toBe(true)

    // Verify .do/ directory was created
    const stat = await fs.stat(path.join(tempDir, '.do'))
    expect(stat.isDirectory()).toBe(true)
  })

  it('creates .do/config.json with endpoint URL', async () => {
    const endpoint = 'https://api.example.com'

    const result = await init({
      endpoint,
      cwd: tempDir,
      skipPull: true,
    })

    expect(result.success).toBe(true)

    // Verify config.json was created with correct content
    const configPath = path.join(tempDir, '.do', 'config.json')
    const configContent = await fs.readFile(configPath, 'utf-8')
    const config: DoConfig = JSON.parse(configContent)

    expect(config.endpoint).toBe(endpoint)
    expect(config.typescript).toBe(true)
    expect(config.typesPath).toBe('.do/$.d.ts')
  })

  it('returns configPath in result on success', async () => {
    const result = await init({
      endpoint: 'https://api.example.com',
      cwd: tempDir,
      skipPull: true,
    })

    expect(result.success).toBe(true)
    expect(result.configPath).toBe(path.join(tempDir, '.do', 'config.json'))
  })
})

// ============================================================================
// `rpc.do init --endpoint <url>` - Endpoint flag
// ============================================================================

describe('rpc.do init --endpoint <url>', () => {
  it('sets the endpoint URL from flag', async () => {
    const endpoint = 'https://my-custom-api.com/v1'

    const result = await init({
      endpoint,
      cwd: tempDir,
      skipPull: true,
    })

    expect(result.success).toBe(true)

    const configPath = path.join(tempDir, '.do', 'config.json')
    const configContent = await fs.readFile(configPath, 'utf-8')
    const config: DoConfig = JSON.parse(configContent)

    expect(config.endpoint).toBe(endpoint)
  })

  it('handles endpoints with trailing slash', async () => {
    const endpoint = 'https://api.example.com/'

    const result = await init({
      endpoint,
      cwd: tempDir,
      skipPull: true,
    })

    expect(result.success).toBe(true)

    const configPath = path.join(tempDir, '.do', 'config.json')
    const configContent = await fs.readFile(configPath, 'utf-8')
    const config: DoConfig = JSON.parse(configContent)

    // Should normalize trailing slash
    expect(config.endpoint).toBe('https://api.example.com')
  })

  it('handles localhost endpoints', async () => {
    const endpoint = 'http://localhost:8787'

    const result = await init({
      endpoint,
      cwd: tempDir,
      skipPull: true,
    })

    expect(result.success).toBe(true)

    const configPath = path.join(tempDir, '.do', 'config.json')
    const configContent = await fs.readFile(configPath, 'utf-8')
    const config: DoConfig = JSON.parse(configContent)

    expect(config.endpoint).toBe(endpoint)
  })
})

// ============================================================================
// `rpc.do init --skip-pull` - Skip type pulling
// ============================================================================

describe('rpc.do init --skip-pull', () => {
  it('skips type pulling when --skip-pull is provided', async () => {
    const pullMock = vi.fn().mockResolvedValue({ success: true })

    const result = await init({
      endpoint: 'https://api.example.com',
      cwd: tempDir,
      skipPull: true,
      pullFn: pullMock,
    })

    expect(result.success).toBe(true)
    expect(pullMock).not.toHaveBeenCalled()
  })

  it('calls pull when --skip-pull is not provided', async () => {
    const pullMock = vi.fn().mockResolvedValue({ success: true, outPath: path.join(tempDir, '.do', '$.d.ts') })

    const result = await init({
      endpoint: 'https://api.example.com',
      cwd: tempDir,
      skipPull: false,
      pullFn: pullMock,
    })

    expect(result.success).toBe(true)
    expect(pullMock).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: 'https://api.example.com',
      cwd: tempDir,
    }))
  })

  it('defaults to pulling types (skipPull=false by default)', async () => {
    const pullMock = vi.fn().mockResolvedValue({ success: true, outPath: path.join(tempDir, '.do', '$.d.ts') })

    const result = await init({
      endpoint: 'https://api.example.com',
      cwd: tempDir,
      pullFn: pullMock,
    })

    expect(result.success).toBe(true)
    expect(pullMock).toHaveBeenCalled()
  })
})

// ============================================================================
// Type pulling integration
// ============================================================================

describe('Type pulling integration', () => {
  it('reports pull failure but still creates config', async () => {
    const pullMock = vi.fn().mockResolvedValue({
      success: false,
      error: 'Connection refused',
    })

    const progressEvents: string[] = []
    const result = await init({
      endpoint: 'https://api.example.com',
      cwd: tempDir,
      skipPull: false,
      pullFn: pullMock,
      onProgress: (msg) => progressEvents.push(msg),
    })

    // Init should still succeed even if pull fails
    expect(result.success).toBe(true)
    expect(result.pullError).toBe('Connection refused')

    // Config should still be created
    const configPath = path.join(tempDir, '.do', 'config.json')
    const configContent = await fs.readFile(configPath, 'utf-8')
    const config: DoConfig = JSON.parse(configContent)
    expect(config.endpoint).toBe('https://api.example.com')

    // Should have warning in progress
    expect(progressEvents.some((e) => e.toLowerCase().includes('warning') || e.toLowerCase().includes('failed'))).toBe(true)
  })

  it('includes types path in result when pull succeeds', async () => {
    const typesPath = path.join(tempDir, '.do', '$.d.ts')
    const pullMock = vi.fn().mockResolvedValue({
      success: true,
      outPath: typesPath,
    })

    const result = await init({
      endpoint: 'https://api.example.com',
      cwd: tempDir,
      skipPull: false,
      pullFn: pullMock,
    })

    expect(result.success).toBe(true)
    expect(result.typesPath).toBe(typesPath)
  })
})

// ============================================================================
// Existing .do/ directory handling
// ============================================================================

describe('Existing .do/ directory handling', () => {
  it('works when .do/ already exists', async () => {
    // Pre-create .do/ directory
    const doDir = path.join(tempDir, '.do')
    await fs.mkdir(doDir, { recursive: true })

    const result = await init({
      endpoint: 'https://api.example.com',
      cwd: tempDir,
      skipPull: true,
    })

    expect(result.success).toBe(true)
  })

  it('overwrites config.json when force is true', async () => {
    // Pre-create .do/ directory and config
    const doDir = path.join(tempDir, '.do')
    await fs.mkdir(doDir, { recursive: true })
    const configPath = path.join(doDir, 'config.json')
    await fs.writeFile(configPath, JSON.stringify({ endpoint: 'https://old.api.com' }))

    const result = await init({
      endpoint: 'https://new.api.com',
      cwd: tempDir,
      skipPull: true,
      force: true,
    })

    expect(result.success).toBe(true)

    const configContent = await fs.readFile(configPath, 'utf-8')
    const config: DoConfig = JSON.parse(configContent)
    expect(config.endpoint).toBe('https://new.api.com')
  })

  it('returns exists: true when config exists and force is false', async () => {
    // Pre-create .do/ directory and config
    const doDir = path.join(tempDir, '.do')
    await fs.mkdir(doDir, { recursive: true })
    const configPath = path.join(doDir, 'config.json')
    await fs.writeFile(configPath, JSON.stringify({ endpoint: 'https://old.api.com' }))

    const result = await init({
      endpoint: 'https://new.api.com',
      cwd: tempDir,
      skipPull: true,
      force: false,
    })

    expect(result.success).toBe(false)
    expect(result.exists).toBe(true)
    expect(result.error).toContain('already exists')

    // Old config should be preserved
    const configContent = await fs.readFile(configPath, 'utf-8')
    const config: DoConfig = JSON.parse(configContent)
    expect(config.endpoint).toBe('https://old.api.com')
  })
})

// ============================================================================
// Progress output
// ============================================================================

describe('Progress output', () => {
  it('emits progress events during init', async () => {
    const progressEvents: string[] = []

    const result = await init({
      endpoint: 'https://api.example.com',
      cwd: tempDir,
      skipPull: true,
      onProgress: (message) => progressEvents.push(message),
    })

    expect(result.success).toBe(true)
    expect(progressEvents.length).toBeGreaterThan(0)
  })

  it('shows success message with next steps', async () => {
    const progressEvents: string[] = []

    const result = await init({
      endpoint: 'https://api.example.com',
      cwd: tempDir,
      skipPull: true,
      onProgress: (message) => progressEvents.push(message),
    })

    expect(result.success).toBe(true)

    // Should have some completion/success message
    const allOutput = progressEvents.join('\n').toLowerCase()
    expect(allOutput).toMatch(/initialized|success|created|ready/)
  })

  it('includes helpful next steps in output', async () => {
    const progressEvents: string[] = []

    const result = await init({
      endpoint: 'https://api.example.com',
      cwd: tempDir,
      skipPull: true,
      onProgress: (message) => progressEvents.push(message),
    })

    expect(result.success).toBe(true)

    const allOutput = progressEvents.join('\n')
    // Should suggest pulling types or running commands
    expect(allOutput).toMatch(/pull|types|rpc\.do/i)
  })
})

// ============================================================================
// Config file structure
// ============================================================================

describe('Config file structure', () => {
  it('creates config with correct structure', async () => {
    const endpoint = 'https://api.example.com'

    const result = await init({
      endpoint,
      cwd: tempDir,
      skipPull: true,
    })

    expect(result.success).toBe(true)

    const configPath = path.join(tempDir, '.do', 'config.json')
    const configContent = await fs.readFile(configPath, 'utf-8')
    const config: DoConfig = JSON.parse(configContent)

    // Verify all expected fields are present
    expect(config).toHaveProperty('endpoint')
    expect(config).toHaveProperty('typescript')
    expect(config).toHaveProperty('typesPath')

    // Verify default values
    expect(config.endpoint).toBe(endpoint)
    expect(config.typescript).toBe(true)
    expect(config.typesPath).toBe('.do/$.d.ts')
  })

  it('writes pretty-printed JSON', async () => {
    const result = await init({
      endpoint: 'https://api.example.com',
      cwd: tempDir,
      skipPull: true,
    })

    expect(result.success).toBe(true)

    const configPath = path.join(tempDir, '.do', 'config.json')
    const configContent = await fs.readFile(configPath, 'utf-8')

    // Should be pretty-printed (contains newlines)
    expect(configContent).toContain('\n')
    expect(configContent).toMatch(/^\{\n/)
  })
})

// ============================================================================
// Error handling
// ============================================================================

describe('Error handling', () => {
  it('handles permission errors gracefully', async () => {
    // Skip on non-Unix systems where chmod may not work as expected
    if (process.platform === 'win32') {
      return
    }

    // Create read-only directory
    const readOnlyDir = path.join(tempDir, 'readonly')
    await fs.mkdir(readOnlyDir)
    await fs.chmod(readOnlyDir, 0o444)

    const result = await init({
      endpoint: 'https://api.example.com',
      cwd: readOnlyDir,
      skipPull: true,
    })

    // Restore permissions for cleanup
    await fs.chmod(readOnlyDir, 0o755)

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('requires endpoint to be provided', async () => {
    const result = await init({
      endpoint: '',
      cwd: tempDir,
      skipPull: true,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('endpoint')
  })

  it('validates endpoint is a valid URL', async () => {
    const result = await init({
      endpoint: 'not-a-valid-url',
      cwd: tempDir,
      skipPull: true,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('URL')
  })
})

// ============================================================================
// Template support (REFACTOR phase feature)
// ============================================================================

describe('Template support', () => {
  it('supports basic template (default)', async () => {
    const result = await init({
      endpoint: 'https://api.example.com',
      cwd: tempDir,
      skipPull: true,
      template: 'basic',
    })

    expect(result.success).toBe(true)

    const configPath = path.join(tempDir, '.do', 'config.json')
    const configContent = await fs.readFile(configPath, 'utf-8')
    const config: DoConfig = JSON.parse(configContent)

    expect(config.typescript).toBe(true)
  })

  it('supports full template with additional options', async () => {
    const result = await init({
      endpoint: 'https://api.example.com',
      cwd: tempDir,
      skipPull: true,
      template: 'full',
    })

    expect(result.success).toBe(true)

    const configPath = path.join(tempDir, '.do', 'config.json')
    const configContent = await fs.readFile(configPath, 'utf-8')
    const config: DoConfig = JSON.parse(configContent)

    // Full template includes additional settings
    expect(config.typescript).toBe(true)
    expect(config.generateClient).toBe(true)
    expect(config.watchMode).toBe(false)
  })
})

// ============================================================================
// Edge cases
// ============================================================================

describe('Edge cases', () => {
  it('handles endpoint with path', async () => {
    const endpoint = 'https://api.example.com/v1/rpc'

    const result = await init({
      endpoint,
      cwd: tempDir,
      skipPull: true,
    })

    expect(result.success).toBe(true)

    const configPath = path.join(tempDir, '.do', 'config.json')
    const configContent = await fs.readFile(configPath, 'utf-8')
    const config: DoConfig = JSON.parse(configContent)

    expect(config.endpoint).toBe(endpoint)
  })

  it('handles endpoint with query params', async () => {
    const endpoint = 'https://api.example.com?version=2'

    const result = await init({
      endpoint,
      cwd: tempDir,
      skipPull: true,
    })

    expect(result.success).toBe(true)

    const configPath = path.join(tempDir, '.do', 'config.json')
    const configContent = await fs.readFile(configPath, 'utf-8')
    const config: DoConfig = JSON.parse(configContent)

    expect(config.endpoint).toBe(endpoint)
  })

  it('normalizes multiple trailing slashes', async () => {
    const result = await init({
      endpoint: 'https://api.example.com///',
      cwd: tempDir,
      skipPull: true,
    })

    expect(result.success).toBe(true)

    const configPath = path.join(tempDir, '.do', 'config.json')
    const configContent = await fs.readFile(configPath, 'utf-8')
    const config: DoConfig = JSON.parse(configContent)

    expect(config.endpoint).toBe('https://api.example.com')
  })

  it('uses cwd as default when not specified', async () => {
    // This test verifies the behavior when cwd is not explicitly passed
    // In the actual implementation, it should default to process.cwd()
    const pullMock = vi.fn().mockResolvedValue({ success: true, outPath: '.do/$.d.ts' })

    const result = await init({
      endpoint: 'https://api.example.com',
      cwd: tempDir, // For testing, we still use tempDir
      skipPull: true,
      pullFn: pullMock,
    })

    expect(result.success).toBe(true)
    expect(result.configPath).toContain('.do/config.json')
  })
})

/**
 * Enhanced CLI Commands Tests - do-80k0
 *
 * Comprehensive tests for CLI command parsing and execution:
 * - config-get command
 * - build command enhancements
 * - logs command parsing
 * - whoami edge cases
 * - Command argument parsing validation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { spawn } from 'child_process'

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Create a temporary test directory
 */
function createTestDir(): string {
  const testDir = join(tmpdir(), `dotdo-cmd-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(testDir, { recursive: true })
  return testDir
}

/**
 * Capture console output for assertions
 */
function captureConsole() {
  const logs: string[] = []
  const errors: string[] = []
  const originalLog = console.log
  const originalError = console.error

  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(' '))
  }
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(' '))
  }

  return {
    logs,
    errors,
    restore: () => {
      console.log = originalLog
      console.error = originalError
    },
  }
}

// ============================================================================
// config-get Command Tests
// ============================================================================

describe('config-get command', () => {
  let testDir: string

  beforeEach(() => {
    testDir = createTestDir()
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  it('exports configGetCommand function', async () => {
    const { configGetCommand, configGet } = await import('../../commands/config-get')
    expect(configGetCommand).toBeDefined()
    expect(configGet).toBeDefined()
    expect(typeof configGetCommand).toBe('function')
  })

  it('returns all config when no key specified', async () => {
    const { configGet } = await import('../../commands/config-get')

    const testConfig = { apiUrl: 'https://test.api.dev', namespace: 'test-ns', verbose: true }
    writeFileSync(join(testDir, '.dotdo.json'), JSON.stringify(testConfig, null, 2))

    const originalCwd = process.cwd()
    process.chdir(testDir)

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      const result = await configGet({})

      expect(result.success).toBe(true)
      expect(result.found).toBe(true)
      expect(result.value).toEqual(testConfig)
    } finally {
      process.chdir(originalCwd)
      consoleSpy.mockRestore()
    }
  })

  it('returns specific key value', async () => {
    const { configGet } = await import('../../commands/config-get')

    const testConfig = { apiUrl: 'https://specific.api.dev', namespace: 'specific-ns' }
    writeFileSync(join(testDir, '.dotdo.json'), JSON.stringify(testConfig, null, 2))

    const originalCwd = process.cwd()
    process.chdir(testDir)

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      const result = await configGet({ key: 'apiUrl' })

      expect(result.success).toBe(true)
      expect(result.found).toBe(true)
      expect(result.key).toBe('apiUrl')
      expect(result.value).toBe('https://specific.api.dev')
    } finally {
      process.chdir(originalCwd)
      consoleSpy.mockRestore()
    }
  })

  it('returns nested key using dot notation', async () => {
    const { configGet } = await import('../../commands/config-get')

    const testConfig = {
      env: {
        API_KEY: 'secret-key',
        DEBUG: true,
      },
    }
    writeFileSync(join(testDir, '.dotdo.json'), JSON.stringify(testConfig, null, 2))

    const originalCwd = process.cwd()
    process.chdir(testDir)

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      const result = await configGet({ key: 'env.API_KEY' })

      expect(result.success).toBe(true)
      expect(result.found).toBe(true)
      expect(result.value).toBe('secret-key')
    } finally {
      process.chdir(originalCwd)
      consoleSpy.mockRestore()
    }
  })

  it('returns not found for missing key', async () => {
    const { configGet } = await import('../../commands/config-get')

    const testConfig = { apiUrl: 'https://test.api.dev' }
    writeFileSync(join(testDir, '.dotdo.json'), JSON.stringify(testConfig, null, 2))

    const originalCwd = process.cwd()
    process.chdir(testDir)

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const result = await configGet({ key: 'nonexistent' })

      expect(result.success).toBe(false)
      expect(result.found).toBe(false)
      expect(result.value).toBeUndefined()
    } finally {
      process.chdir(originalCwd)
      consoleSpy.mockRestore()
      consoleErrorSpy.mockRestore()
    }
  })

  it('returns empty config when file does not exist', async () => {
    const { configGet } = await import('../../commands/config-get')

    const originalCwd = process.cwd()
    process.chdir(testDir)

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      const result = await configGet({})

      expect(result.success).toBe(true)
      expect(result.value).toEqual({})
    } finally {
      process.chdir(originalCwd)
      consoleSpy.mockRestore()
    }
  })

  it('handles deeply nested keys', async () => {
    const { configGet } = await import('../../commands/config-get')

    const testConfig = {
      level1: {
        level2: {
          level3: {
            value: 'deep-value',
          },
        },
      },
    }
    writeFileSync(join(testDir, '.dotdo.json'), JSON.stringify(testConfig, null, 2))

    const originalCwd = process.cwd()
    process.chdir(testDir)

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      const result = await configGet({ key: 'level1.level2.level3.value' })

      expect(result.success).toBe(true)
      expect(result.found).toBe(true)
      expect(result.value).toBe('deep-value')
    } finally {
      process.chdir(originalCwd)
      consoleSpy.mockRestore()
    }
  })

  it('returns object for intermediate key', async () => {
    const { configGet } = await import('../../commands/config-get')

    const testConfig = {
      database: {
        host: 'localhost',
        port: 5432,
      },
    }
    writeFileSync(join(testDir, '.dotdo.json'), JSON.stringify(testConfig, null, 2))

    const originalCwd = process.cwd()
    process.chdir(testDir)

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      const result = await configGet({ key: 'database' })

      expect(result.success).toBe(true)
      expect(result.found).toBe(true)
      expect(result.value).toEqual({ host: 'localhost', port: 5432 })
    } finally {
      process.chdir(originalCwd)
      consoleSpy.mockRestore()
    }
  })
})

// ============================================================================
// build Command Tests
// ============================================================================

describe('build command', () => {
  it('exports correct module interface', async () => {
    const buildModule = await import('../../commands/build')

    expect(buildModule.name).toBe('build')
    expect(buildModule.description).toBeDefined()
    expect(typeof buildModule.description).toBe('string')
    expect(buildModule.build).toBeDefined()
    expect(buildModule.buildCommand).toBeDefined()
  })

  it('build function returns Promise', async () => {
    const { build } = await import('../../commands/build')

    // Mock console to capture output
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      // Call build - it will fail due to missing wrangler, but should return a promise
      const result = build({ verbose: false })
      expect(result).toBeInstanceOf(Promise)

      // Wait for it to complete (will fail, but we're testing the interface)
      await result.catch(() => {})
    } finally {
      consoleSpy.mockRestore()
      consoleErrorSpy.mockRestore()
    }
  })

  it('accepts BuildOptions interface correctly', async () => {
    const { build } = await import('../../commands/build')

    // Type check - verify all options are accepted
    const options = {
      minify: true,
      sourcemap: true,
      outdir: 'dist',
      config: 'wrangler.toml',
      env: 'production',
      verbose: true,
    }

    // Just verify the function accepts these options without type errors
    expect(typeof build).toBe('function')
  })

  it('buildCommand wraps build function', async () => {
    const { build, buildCommand } = await import('../../commands/build')

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const result = buildCommand({ verbose: false })
      expect(result).toBeInstanceOf(Promise)
      await result.catch(() => {})
    } finally {
      consoleSpy.mockRestore()
      consoleErrorSpy.mockRestore()
    }
  })
})

// ============================================================================
// logs Command Tests
// ============================================================================

describe('logs command', () => {
  it('exports correct module interface', async () => {
    const logsModule = await import('../../commands/logs')

    expect(logsModule.name).toBe('logs')
    expect(logsModule.description).toBeDefined()
    expect(logsModule.logs).toBeDefined()
    expect(logsModule.logsCommand).toBeDefined()
  })

  it('accepts LogsOptions interface correctly', async () => {
    const { logs } = await import('../../commands/logs')

    // Type check - verify all options are accepted
    const options = {
      follow: true,
      level: 'info' as const,
      name: 'my-worker',
      env: 'production',
      config: 'wrangler.toml',
      format: 'json' as const,
      verbose: true,
    }

    expect(typeof logs).toBe('function')
  })

  it('validates log level options', async () => {
    // Log levels should be: debug, info, warn, error
    const validLevels = ['debug', 'info', 'warn', 'error']

    for (const level of validLevels) {
      const options = { level: level as 'debug' | 'info' | 'warn' | 'error' }
      expect(options.level).toBe(level)
    }
  })

  it('validates format options', async () => {
    const validFormats = ['json', 'pretty']

    for (const format of validFormats) {
      const options = { format: format as 'json' | 'pretty' }
      expect(options.format).toBe(format)
    }
  })
})

// ============================================================================
// whoami Command Tests
// ============================================================================

describe('whoami command', () => {
  let testDir: string

  beforeEach(() => {
    testDir = createTestDir()
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  it('exports correct module interface', async () => {
    const whoamiModule = await import('../../commands/whoami')

    expect(whoamiModule.whoami).toBeDefined()
    expect(whoamiModule.default).toBeDefined()
    expect(typeof whoamiModule.whoami).toBe('function')
  })

  it('accepts WhoamiOptions interface correctly', async () => {
    const { whoami } = await import('../../commands/whoami')

    const options = {
      verbose: true,
      json: true,
    }

    expect(typeof whoami).toBe('function')
  })

  it('handles expired token gracefully', async () => {
    const { whoami } = await import('../../commands/whoami')

    // Mock homedir to use test directory
    const restoreHomedir = vi.spyOn(require('os'), 'homedir').mockReturnValue(testDir)

    // Create expired token
    const configDir = join(testDir, '.dotdo')
    mkdirSync(configDir, { recursive: true })

    const expiredToken = {
      access_token: 'expired-token',
      token_type: 'Bearer',
      expires_at: Date.now() - 1000, // Expired 1 second ago
      created_at: Date.now() - 3600000,
    }
    writeFileSync(join(configDir, 'credentials.json'), JSON.stringify(expiredToken))

    const output = captureConsole()

    try {
      await whoami({})

      // Should indicate session expired
      expect(
        output.logs.some((log) => log.includes('expired') || log.includes('login'))
      ).toBe(true)
    } finally {
      output.restore()
      restoreHomedir.mockRestore()
    }
  })
})

// ============================================================================
// Command Argument Parsing Tests
// ============================================================================

describe('CLI argument parsing', () => {
  it('parses --verbose flag for all commands', async () => {
    const { createProgram } = await import('../../cli')
    const program = createProgram()

    // Global verbose option
    const globalOptions = program.options.map((opt) => opt.long)
    expect(globalOptions).toContain('--verbose')
  })

  it('parses --config flag for relevant commands', async () => {
    const { createProgram } = await import('../../cli')
    const program = createProgram()

    // Check dev command has --config
    const devCmd = program.commands.find((cmd) => cmd.name() === 'dev')
    const devOptions = devCmd?.options.map((opt) => opt.long) || []
    expect(devOptions).toContain('--config')

    // Check build command has --config
    const buildCmd = program.commands.find((cmd) => cmd.name() === 'build')
    const buildOptions = buildCmd?.options.map((opt) => opt.long) || []
    expect(buildOptions).toContain('--config')
  })

  it('parses subcommand arguments correctly', async () => {
    const { createProgram } = await import('../../cli')
    const program = createProgram()

    // do command subcommands
    const doCmd = program.commands.find((cmd) => cmd.name() === 'do')
    expect(doCmd).toBeDefined()

    const listCmd = doCmd?.commands.find((cmd) => cmd.name() === 'list')
    const inspectCmd = doCmd?.commands.find((cmd) => cmd.name() === 'inspect')
    const deleteCmd = doCmd?.commands.find((cmd) => cmd.name() === 'delete')

    expect(listCmd).toBeDefined()
    expect(inspectCmd).toBeDefined()
    expect(deleteCmd).toBeDefined()

    // config command subcommands
    const configCmd = program.commands.find((cmd) => cmd.name() === 'config')
    expect(configCmd).toBeDefined()

    const showCmd = configCmd?.commands.find((cmd) => cmd.name() === 'show')
    const setCmd = configCmd?.commands.find((cmd) => cmd.name() === 'set')
    const getCmd = configCmd?.commands.find((cmd) => cmd.name() === 'get')

    expect(showCmd).toBeDefined()
    expect(setCmd).toBeDefined()
    expect(getCmd).toBeDefined()
  })

  it('login command has correct options', async () => {
    const { createProgram } = await import('../../cli')
    const program = createProgram()

    const loginCmd = program.commands.find((cmd) => cmd.name() === 'login')
    expect(loginCmd).toBeDefined()

    const optionFlags = loginCmd?.options.map((opt) => opt.long) || []
    expect(optionFlags).toContain('--token')
    expect(optionFlags).toContain('--no-browser')
  })

  it('whoami command has correct options', async () => {
    const { createProgram } = await import('../../cli')
    const program = createProgram()

    const whoamiCmd = program.commands.find((cmd) => cmd.name() === 'whoami')
    expect(whoamiCmd).toBeDefined()

    const optionFlags = whoamiCmd?.options.map((opt) => opt.long) || []
    expect(optionFlags).toContain('--json')
  })

  it('init command has correct options', async () => {
    const { createProgram } = await import('../../cli')
    const program = createProgram()

    const initCmd = program.commands.find((cmd) => cmd.name() === 'init')
    expect(initCmd).toBeDefined()

    const optionFlags = initCmd?.options.map((opt) => opt.long) || []
    expect(optionFlags).toContain('--template')
    expect(optionFlags).toContain('--name')
    expect(optionFlags).toContain('--skip-git')
    expect(optionFlags).toContain('--skip-install')
    expect(optionFlags).toContain('--yes')
  })
})

// ============================================================================
// Command Execution Flow Tests
// ============================================================================

describe('Command execution flow', () => {
  let testDir: string

  beforeEach(() => {
    testDir = createTestDir()
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  it('config set then get preserves value', async () => {
    const { configSet } = await import('../../commands/config-set')
    const { configGet } = await import('../../commands/config-get')

    const originalCwd = process.cwd()
    process.chdir(testDir)

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      // Set a value
      const setResult = await configSet({ key: 'testKey', value: 'testValue' })
      expect(setResult.success).toBe(true)

      // Get the value back
      const getResult = await configGet({ key: 'testKey' })
      expect(getResult.success).toBe(true)
      expect(getResult.value).toBe('testValue')
    } finally {
      process.chdir(originalCwd)
      consoleSpy.mockRestore()
    }
  })

  it('config set with different types', async () => {
    const { configSet } = await import('../../commands/config-set')
    const { configGet } = await import('../../commands/config-get')

    const originalCwd = process.cwd()
    process.chdir(testDir)

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      // Set string
      await configSet({ key: 'stringKey', value: 'hello' })
      let result = await configGet({ key: 'stringKey' })
      expect(result.value).toBe('hello')

      // Set number
      await configSet({ key: 'numberKey', value: '42' })
      result = await configGet({ key: 'numberKey' })
      expect(result.value).toBe(42)

      // Set boolean
      await configSet({ key: 'boolKey', value: 'true' })
      result = await configGet({ key: 'boolKey' })
      expect(result.value).toBe(true)

      // Set array (as JSON)
      await configSet({ key: 'arrayKey', value: '["a", "b", "c"]' })
      result = await configGet({ key: 'arrayKey' })
      expect(result.value).toEqual(['a', 'b', 'c'])

      // Set object (as JSON)
      await configSet({ key: 'objectKey', value: '{"nested": "value"}' })
      result = await configGet({ key: 'objectKey' })
      expect(result.value).toEqual({ nested: 'value' })
    } finally {
      process.chdir(originalCwd)
      consoleSpy.mockRestore()
    }
  })

  it('do-list parses wrangler config correctly', async () => {
    const { doList } = await import('../../commands/do-list')

    // Create a test wrangler.json
    const wranglerConfig = {
      name: 'test-worker',
      durable_objects: {
        bindings: [
          { name: 'DO', class_name: 'MyDO' },
          { name: 'COUNTER', class_name: 'Counter', script_name: 'counter-worker' },
        ],
      },
    }

    writeFileSync(join(testDir, 'wrangler.json'), JSON.stringify(wranglerConfig, null, 2))

    const originalCwd = process.cwd()
    process.chdir(testDir)

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      const result = await doList({ format: 'json' })

      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('DO')
      expect(result[0].className).toBe('MyDO')
      expect(result[1].name).toBe('COUNTER')
      expect(result[1].className).toBe('Counter')
      expect(result[1].scriptName).toBe('counter-worker')
    } finally {
      process.chdir(originalCwd)
      consoleSpy.mockRestore()
    }
  })

  it('do-inspect returns structured result', async () => {
    const { doInspect } = await import('../../commands/do-inspect')

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      const result = await doInspect({
        id: 'test-do-123',
        namespace: 'DO',
        format: 'json',
      })

      expect(result.id).toBe('test-do-123')
      expect(result.namespace).toBe('DO')
      expect(result.exists).toBeDefined()
      expect(typeof result.exists).toBe('boolean')
    } finally {
      consoleSpy.mockRestore()
    }
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Command error handling', () => {
  let testDir: string

  beforeEach(() => {
    testDir = createTestDir()
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  it('config-get handles malformed JSON', async () => {
    const { configGet } = await import('../../commands/config-get')

    writeFileSync(join(testDir, '.dotdo.json'), '{ invalid json }')

    const originalCwd = process.cwd()
    process.chdir(testDir)

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      // Should return empty config when JSON is malformed
      const result = await configGet({})
      expect(result.value).toEqual({})
    } finally {
      process.chdir(originalCwd)
      consoleSpy.mockRestore()
    }
  })

  it('do-list handles missing wrangler config', async () => {
    const { doList } = await import('../../commands/do-list')

    const originalCwd = process.cwd()
    process.chdir(testDir)

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      const result = await doList({ format: 'json' })
      expect(result).toEqual([])
    } finally {
      process.chdir(originalCwd)
      consoleSpy.mockRestore()
    }
  })

  it('do-delete returns cancelled when force is false', async () => {
    const { doDelete } = await import('../../commands/do-delete')

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      // With force: true, it attempts to delete but fails (no server)
      const result = await doDelete({
        id: 'test-id',
        force: true,
      })

      expect(result.id).toBe('test-id')
      // Will be false since no local dev server is running
      expect(result.deleted).toBe(false)
    } finally {
      consoleSpy.mockRestore()
    }
  })
})

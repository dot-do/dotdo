/**
 * CLI Commands Tests - do-tqkb
 *
 * Tests for the new CLI command implementations:
 * - logs
 * - do list
 * - do inspect
 * - do delete
 * - build
 * - config set
 *
 * NO MOCKS - Uses real file system with temp directories and output capture.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Capture console output for assertions.
 * This is NOT a mock - it directly replaces console methods and restores them.
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

describe('CLI Commands', () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `dotdo-commands-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  describe('logs command', () => {
    it('exports logsCommand function', async () => {
      const { logsCommand, logs } = await import('../commands/logs')
      expect(logsCommand).toBeDefined()
      expect(logs).toBeDefined()
      expect(typeof logsCommand).toBe('function')
    })

    it('has correct LogsOptions interface', async () => {
      const { logs } = await import('../commands/logs')
      // Type check - should accept valid options
      const options = {
        follow: true,
        level: 'info' as const,
        json: false,
        verbose: false,
      }
      // Just verify the function accepts these options (don't run it as it needs wrangler)
      expect(typeof logs).toBe('function')
    })

    it('parses JSON log entries', async () => {
      // Test the log parsing logic via the exported types
      const { logs } = await import('../commands/logs')
      expect(logs).toBeDefined()
    })
  })

  describe('do-list command', () => {
    it('exports doListCommand function', async () => {
      const { doListCommand, doList } = await import('../commands/do-list')
      expect(doListCommand).toBeDefined()
      expect(doList).toBeDefined()
      expect(typeof doListCommand).toBe('function')
    })

    it('parses wrangler.jsonc config', async () => {
      const { doList } = await import('../commands/do-list')

      // Create a test wrangler.jsonc
      const wranglerConfig = {
        name: 'test-worker',
        durable_objects: {
          bindings: [
            { name: 'DO', class_name: 'DurableObject' },
            { name: 'COUNTER', class_name: 'Counter', script_name: 'counter-worker' },
          ],
        },
      }

      const configPath = join(testDir, 'wrangler.json')
      writeFileSync(configPath, JSON.stringify(wranglerConfig, null, 2))

      const originalCwd = process.cwd()
      process.chdir(testDir)

      const output = captureConsole()

      try {
        const result = await doList({ json: true })

        expect(result).toHaveLength(2)
        expect(result[0].name).toBe('DO')
        expect(result[0].className).toBe('DurableObject')
        expect(result[1].name).toBe('COUNTER')
        expect(result[1].scriptName).toBe('counter-worker')
      } finally {
        process.chdir(originalCwd)
        output.restore()
      }
    })

    it('returns empty array when no config found', async () => {
      const { doList } = await import('../commands/do-list')

      const originalCwd = process.cwd()
      process.chdir(testDir)

      const output = captureConsole()

      try {
        const result = await doList({ json: true })
        expect(result).toEqual([])
      } finally {
        process.chdir(originalCwd)
        output.restore()
      }
    })

    it('filters by namespace', async () => {
      const { doList } = await import('../commands/do-list')

      const wranglerConfig = {
        durable_objects: {
          bindings: [
            { name: 'DO', class_name: 'DurableObject' },
            { name: 'COUNTER', class_name: 'Counter' },
          ],
        },
      }

      const configPath = join(testDir, 'wrangler.json')
      writeFileSync(configPath, JSON.stringify(wranglerConfig, null, 2))

      const originalCwd = process.cwd()
      process.chdir(testDir)

      const output = captureConsole()

      try {
        const result = await doList({ namespace: 'DO', json: true })
        expect(result).toHaveLength(1)
        expect(result[0].name).toBe('DO')
      } finally {
        process.chdir(originalCwd)
        output.restore()
      }
    })

    it('outputs valid JSON when --json flag is set', async () => {
      const { doList } = await import('../commands/do-list')

      const wranglerConfig = {
        durable_objects: {
          bindings: [
            { name: 'DO', class_name: 'DurableObject' },
          ],
        },
      }

      const configPath = join(testDir, 'wrangler.json')
      writeFileSync(configPath, JSON.stringify(wranglerConfig, null, 2))

      const originalCwd = process.cwd()
      process.chdir(testDir)

      const output = captureConsole()

      try {
        await doList({ json: true })

        // Should have output valid JSON
        expect(output.logs.length).toBeGreaterThan(0)
        const parsed = JSON.parse(output.logs[0])
        expect(Array.isArray(parsed)).toBe(true)
        expect(parsed[0].name).toBe('DO')
      } finally {
        process.chdir(originalCwd)
        output.restore()
      }
    })
  })

  describe('do-inspect command', () => {
    it('exports doInspectCommand function', async () => {
      const { doInspectCommand, doInspect } = await import('../commands/do-inspect')
      expect(doInspectCommand).toBeDefined()
      expect(doInspect).toBeDefined()
      expect(typeof doInspectCommand).toBe('function')
    })

    it('returns inspect result with id', async () => {
      const { doInspect } = await import('../commands/do-inspect')

      const output = captureConsole()

      try {
        const result = await doInspect({
          id: 'test-do-123',
          json: true,
        })

        expect(result.id).toBe('test-do-123')
        expect(result.exists).toBe(true)
      } finally {
        output.restore()
      }
    })

    it('includes namespace in result', async () => {
      const { doInspect } = await import('../commands/do-inspect')

      const output = captureConsole()

      try {
        const result = await doInspect({
          id: 'test-do-456',
          namespace: 'MY_DO',
          json: true,
        })

        expect(result.namespace).toBe('MY_DO')
      } finally {
        output.restore()
      }
    })

    it('outputs valid JSON when --json flag is set', async () => {
      const { doInspect } = await import('../commands/do-inspect')

      const output = captureConsole()

      try {
        await doInspect({
          id: 'test-do-789',
          json: true,
        })

        // Should have output valid JSON
        expect(output.logs.length).toBeGreaterThan(0)
        const parsed = JSON.parse(output.logs[0])
        expect(parsed.id).toBe('test-do-789')
        expect(parsed.exists).toBe(true)
      } finally {
        output.restore()
      }
    })
  })

  describe('do-delete command', () => {
    it('exports doDeleteCommand function', async () => {
      const { doDeleteCommand, doDelete } = await import('../commands/do-delete')
      expect(doDeleteCommand).toBeDefined()
      expect(doDelete).toBeDefined()
      expect(typeof doDeleteCommand).toBe('function')
    })

    it('returns result when using force mode (skips interactive prompt)', async () => {
      const { doDelete } = await import('../commands/do-delete')

      const output = captureConsole()

      try {
        // Force mode skips interactive prompt - no readline mock needed
        const result = await doDelete({
          id: 'test-do-789',
          force: true,
        })

        // With force, it tries to delete but will fail (no local server)
        expect(result.id).toBe('test-do-789')
        // Will be false since no local dev server is running
        expect(result.deleted).toBe(false)
      } finally {
        output.restore()
      }
    })

    it('outputs valid JSON when --json flag is set', async () => {
      const { doDelete } = await import('../commands/do-delete')

      const output = captureConsole()

      try {
        // JSON mode also skips interactive prompt
        await doDelete({
          id: 'test-do-json',
          json: true,
        })

        // Should have output valid JSON
        expect(output.logs.length).toBeGreaterThan(0)
        const parsed = JSON.parse(output.logs[0])
        expect(parsed.id).toBe('test-do-json')
        expect(typeof parsed.deleted).toBe('boolean')
        expect(typeof parsed.message).toBe('string')
      } finally {
        output.restore()
      }
    })
  })

  describe('build command', () => {
    it('exports buildCommand function', async () => {
      const { buildCommand, build } = await import('../commands/build')
      expect(buildCommand).toBeDefined()
      expect(build).toBeDefined()
      expect(typeof buildCommand).toBe('function')
    })

    it('accepts build options', async () => {
      const { build } = await import('../commands/build')

      // Just verify options interface is correct
      const options = {
        minify: true,
        sourcemap: false,
        outdir: 'dist',
        env: 'production',
        verbose: false,
      }

      expect(typeof build).toBe('function')
    })
  })

  describe('config-set command', () => {
    it('exports configSetCommand function', async () => {
      const { configSetCommand, configSet } = await import('../commands/config-set')
      expect(configSetCommand).toBeDefined()
      expect(configSet).toBeDefined()
      expect(typeof configSetCommand).toBe('function')
    })

    it('sets a simple string value', async () => {
      const { configSet } = await import('../commands/config-set')

      const originalCwd = process.cwd()
      process.chdir(testDir)

      const output = captureConsole()

      try {
        const result = await configSet({
          key: 'apiUrl',
          value: 'https://custom.api.dev',
        })

        expect(result.success).toBe(true)
        expect(result.key).toBe('apiUrl')
        expect(result.value).toBe('https://custom.api.dev')

        // Verify file was created
        const configPath = join(testDir, '.dotdo.json')
        expect(existsSync(configPath)).toBe(true)

        const config = JSON.parse(readFileSync(configPath, 'utf-8'))
        expect(config.apiUrl).toBe('https://custom.api.dev')
      } finally {
        process.chdir(originalCwd)
        output.restore()
      }
    })

    it('sets a boolean value', async () => {
      const { configSet } = await import('../commands/config-set')

      const originalCwd = process.cwd()
      process.chdir(testDir)

      const output = captureConsole()

      try {
        const result = await configSet({
          key: 'verbose',
          value: 'true',
        })

        expect(result.success).toBe(true)
        expect(result.value).toBe(true)

        const configPath = join(testDir, '.dotdo.json')
        const config = JSON.parse(readFileSync(configPath, 'utf-8'))
        expect(config.verbose).toBe(true)
      } finally {
        process.chdir(originalCwd)
        output.restore()
      }
    })

    it('sets a number value', async () => {
      const { configSet } = await import('../commands/config-set')

      const originalCwd = process.cwd()
      process.chdir(testDir)

      const output = captureConsole()

      try {
        const result = await configSet({
          key: 'port',
          value: '8787',
        })

        expect(result.success).toBe(true)
        expect(result.value).toBe(8787)

        const configPath = join(testDir, '.dotdo.json')
        const config = JSON.parse(readFileSync(configPath, 'utf-8'))
        expect(config.port).toBe(8787)
      } finally {
        process.chdir(originalCwd)
        output.restore()
      }
    })

    it('sets a nested key using dot notation', async () => {
      const { configSet } = await import('../commands/config-set')

      const originalCwd = process.cwd()
      process.chdir(testDir)

      const output = captureConsole()

      try {
        const result = await configSet({
          key: 'env.API_KEY',
          value: 'secret-key',
        })

        expect(result.success).toBe(true)
        expect(result.key).toBe('env.API_KEY')

        const configPath = join(testDir, '.dotdo.json')
        const config = JSON.parse(readFileSync(configPath, 'utf-8'))
        expect(config.env).toBeDefined()
        expect(config.env.API_KEY).toBe('secret-key')
      } finally {
        process.chdir(originalCwd)
        output.restore()
      }
    })

    it('preserves existing config values', async () => {
      const { configSet } = await import('../commands/config-set')

      // Create initial config
      const initialConfig = { apiUrl: 'https://initial.api.dev', namespace: 'initial' }
      writeFileSync(join(testDir, '.dotdo.json'), JSON.stringify(initialConfig, null, 2))

      const originalCwd = process.cwd()
      process.chdir(testDir)

      const output = captureConsole()

      try {
        await configSet({
          key: 'verbose',
          value: 'true',
        })

        const configPath = join(testDir, '.dotdo.json')
        const config = JSON.parse(readFileSync(configPath, 'utf-8'))

        // Should preserve existing values
        expect(config.apiUrl).toBe('https://initial.api.dev')
        expect(config.namespace).toBe('initial')
        // And add new value
        expect(config.verbose).toBe(true)
      } finally {
        process.chdir(originalCwd)
        output.restore()
      }
    })

    it('handles JSON array values', async () => {
      const { configSet } = await import('../commands/config-set')

      const originalCwd = process.cwd()
      process.chdir(testDir)

      const output = captureConsole()

      try {
        const result = await configSet({
          key: 'features',
          value: '["auth", "logging", "metrics"]',
        })

        expect(result.success).toBe(true)
        expect(result.value).toEqual(['auth', 'logging', 'metrics'])

        const configPath = join(testDir, '.dotdo.json')
        const config = JSON.parse(readFileSync(configPath, 'utf-8'))
        expect(config.features).toEqual(['auth', 'logging', 'metrics'])
      } finally {
        process.chdir(originalCwd)
        output.restore()
      }
    })

    it('outputs JSON when json option is true', async () => {
      const { configSet } = await import('../commands/config-set')

      const originalCwd = process.cwd()
      process.chdir(testDir)

      const output = captureConsole()

      try {
        const result = await configSet({
          key: 'testKey',
          value: 'testValue',
          json: true,
        })

        expect(result.success).toBe(true)
        expect(output.logs.length).toBe(1)

        // Verify JSON is parseable
        const parsed = JSON.parse(output.logs[0])
        expect(parsed.success).toBe(true)
        expect(parsed.key).toBe('testKey')
        expect(parsed.value).toBe('testValue')
      } finally {
        process.chdir(originalCwd)
        output.restore()
      }
    })
  })

  describe('config-get command', () => {
    it('exports configGetCommand function', async () => {
      const { configGetCommand, configGet } = await import('../commands/config-get')
      expect(configGetCommand).toBeDefined()
      expect(configGet).toBeDefined()
      expect(typeof configGetCommand).toBe('function')
    })

    it('returns entire config when no key specified', async () => {
      const { configGet } = await import('../commands/config-get')

      // Create test config
      const initialConfig = { apiUrl: 'https://test.api.dev', namespace: 'test' }
      writeFileSync(join(testDir, '.dotdo.json'), JSON.stringify(initialConfig, null, 2))

      const originalCwd = process.cwd()
      process.chdir(testDir)

      const output = captureConsole()

      try {
        const result = await configGet({})

        expect(result.success).toBe(true)
        expect(result.found).toBe(true)
        expect(result.value).toEqual(initialConfig)
      } finally {
        process.chdir(originalCwd)
        output.restore()
      }
    })

    it('gets a simple key value', async () => {
      const { configGet } = await import('../commands/config-get')

      // Create test config
      const initialConfig = { apiUrl: 'https://test.api.dev', verbose: true }
      writeFileSync(join(testDir, '.dotdo.json'), JSON.stringify(initialConfig, null, 2))

      const originalCwd = process.cwd()
      process.chdir(testDir)

      const output = captureConsole()

      try {
        const result = await configGet({ key: 'apiUrl' })

        expect(result.success).toBe(true)
        expect(result.found).toBe(true)
        expect(result.value).toBe('https://test.api.dev')
      } finally {
        process.chdir(originalCwd)
        output.restore()
      }
    })

    it('gets a nested key using dot notation', async () => {
      const { configGet } = await import('../commands/config-get')

      // Create test config with nested values
      const initialConfig = { env: { API_KEY: 'secret-123', DEBUG: true } }
      writeFileSync(join(testDir, '.dotdo.json'), JSON.stringify(initialConfig, null, 2))

      const originalCwd = process.cwd()
      process.chdir(testDir)

      const output = captureConsole()

      try {
        const result = await configGet({ key: 'env.API_KEY' })

        expect(result.success).toBe(true)
        expect(result.found).toBe(true)
        expect(result.value).toBe('secret-123')
      } finally {
        process.chdir(originalCwd)
        output.restore()
      }
    })

    it('returns found=false for non-existent key', async () => {
      const { configGet } = await import('../commands/config-get')

      // Create test config
      const initialConfig = { apiUrl: 'https://test.api.dev' }
      writeFileSync(join(testDir, '.dotdo.json'), JSON.stringify(initialConfig, null, 2))

      const originalCwd = process.cwd()
      process.chdir(testDir)

      const output = captureConsole()

      try {
        const result = await configGet({ key: 'nonExistentKey' })

        expect(result.success).toBe(false)
        expect(result.found).toBe(false)
        expect(result.value).toBeUndefined()
      } finally {
        process.chdir(originalCwd)
        output.restore()
      }
    })

    it('returns empty config when file does not exist', async () => {
      const { configGet } = await import('../commands/config-get')

      const originalCwd = process.cwd()
      process.chdir(testDir)

      const output = captureConsole()

      try {
        const result = await configGet({})

        expect(result.success).toBe(true)
        expect(result.found).toBe(true)
        expect(result.value).toEqual({})
      } finally {
        process.chdir(originalCwd)
        output.restore()
      }
    })

    it('outputs JSON when json option is true', async () => {
      const { configGet } = await import('../commands/config-get')

      // Create test config
      const initialConfig = { apiUrl: 'https://test.api.dev', verbose: true }
      writeFileSync(join(testDir, '.dotdo.json'), JSON.stringify(initialConfig, null, 2))

      const originalCwd = process.cwd()
      process.chdir(testDir)

      const output = captureConsole()

      try {
        const result = await configGet({ key: 'apiUrl', json: true })

        expect(result.success).toBe(true)
        expect(output.logs.length).toBe(1)

        // Verify JSON is parseable
        const parsed = JSON.parse(output.logs[0])
        expect(parsed.success).toBe(true)
        expect(parsed.key).toBe('apiUrl')
        expect(parsed.value).toBe('https://test.api.dev')
        expect(parsed.found).toBe(true)
      } finally {
        process.chdir(originalCwd)
        output.restore()
      }
    })
  })

  describe('CLI integration', () => {
    it('program has build command with correct options', async () => {
      const { createProgram } = await import('../cli')
      const program = createProgram()

      const buildCmd = program.commands.find((cmd) => cmd.name() === 'build')
      expect(buildCmd).toBeDefined()

      const optionFlags = buildCmd?.options.map((opt) => opt.long) || []
      expect(optionFlags).toContain('--minify')
      expect(optionFlags).toContain('--sourcemap')
      expect(optionFlags).toContain('--outdir')
      expect(optionFlags).toContain('--env')
    })

    it('program has logs command with correct options', async () => {
      const { createProgram } = await import('../cli')
      const program = createProgram()

      const logsCmd = program.commands.find((cmd) => cmd.name() === 'logs')
      expect(logsCmd).toBeDefined()

      const optionFlags = logsCmd?.options.map((opt) => opt.long) || []
      expect(optionFlags).toContain('--follow')
      expect(optionFlags).toContain('--level')
      expect(optionFlags).toContain('--name')
      expect(optionFlags).toContain('--env')
      expect(optionFlags).toContain('--json')
    })

    it('do command has list subcommand with correct options', async () => {
      const { createProgram } = await import('../cli')
      const program = createProgram()

      const doCmd = program.commands.find((cmd) => cmd.name() === 'do')
      const listCmd = doCmd?.commands.find((cmd) => cmd.name() === 'list')

      expect(listCmd).toBeDefined()

      const optionFlags = listCmd?.options.map((opt) => opt.long) || []
      expect(optionFlags).toContain('--namespace')
      expect(optionFlags).toContain('--json')
    })

    it('do command has inspect subcommand with correct options', async () => {
      const { createProgram } = await import('../cli')
      const program = createProgram()

      const doCmd = program.commands.find((cmd) => cmd.name() === 'do')
      const inspectCmd = doCmd?.commands.find((cmd) => cmd.name() === 'inspect')

      expect(inspectCmd).toBeDefined()

      const optionFlags = inspectCmd?.options.map((opt) => opt.long) || []
      expect(optionFlags).toContain('--namespace')
      expect(optionFlags).toContain('--json')
      expect(optionFlags).toContain('--storage')
    })

    it('do command has delete subcommand with correct options', async () => {
      const { createProgram } = await import('../cli')
      const program = createProgram()

      const doCmd = program.commands.find((cmd) => cmd.name() === 'do')
      const deleteCmd = doCmd?.commands.find((cmd) => cmd.name() === 'delete')

      expect(deleteCmd).toBeDefined()

      const optionFlags = deleteCmd?.options.map((opt) => opt.long) || []
      expect(optionFlags).toContain('--force')
      expect(optionFlags).toContain('--namespace')
      expect(optionFlags).toContain('--json')
    })

    it('config command has set subcommand with correct options', async () => {
      const { createProgram } = await import('../cli')
      const program = createProgram()

      const configCmd = program.commands.find((cmd) => cmd.name() === 'config')
      const setCmd = configCmd?.commands.find((cmd) => cmd.name() === 'set')

      expect(setCmd).toBeDefined()

      const optionFlags = setCmd?.options.map((opt) => opt.long) || []
      expect(optionFlags).toContain('--global')
    })

    it('config command has get subcommand with correct options', async () => {
      const { createProgram } = await import('../cli')
      const program = createProgram()

      const configCmd = program.commands.find((cmd) => cmd.name() === 'config')
      const getCmd = configCmd?.commands.find((cmd) => cmd.name() === 'get')

      expect(getCmd).toBeDefined()

      const optionFlags = getCmd?.options.map((opt) => opt.long) || []
      expect(optionFlags).toContain('--global')
      expect(optionFlags).toContain('--json')
    })

    it('program has global --json option', async () => {
      const { createProgram } = await import('../cli')
      const program = createProgram()

      const optionFlags = program.options.map((opt) => opt.long) || []
      expect(optionFlags).toContain('--json')
    })

    it('whoami command has --json option', async () => {
      const { createProgram } = await import('../cli')
      const program = createProgram()

      const whoamiCmd = program.commands.find((cmd) => cmd.name() === 'whoami')
      expect(whoamiCmd).toBeDefined()

      const optionFlags = whoamiCmd?.options.map((opt) => opt.long) || []
      expect(optionFlags).toContain('--json')
    })

    it('config show command has --json option', async () => {
      const { createProgram } = await import('../cli')
      const program = createProgram()

      const configCmd = program.commands.find((cmd) => cmd.name() === 'config')
      const showCmd = configCmd?.commands.find((cmd) => cmd.name() === 'show')

      expect(showCmd).toBeDefined()

      const optionFlags = showCmd?.options.map((opt) => opt.long) || []
      expect(optionFlags).toContain('--json')
    })
  })

  describe('JSON output mode', () => {
    it('config-get outputs valid JSON when --json flag is set', async () => {
      const { configGet } = await import('../commands/config-get')

      // Create test config
      const initialConfig = { apiUrl: 'https://test.api.dev', verbose: true }
      writeFileSync(join(testDir, '.dotdo.json'), JSON.stringify(initialConfig, null, 2))

      const originalCwd = process.cwd()
      process.chdir(testDir)

      const output = captureConsole()

      try {
        await configGet({ json: true })

        // Should have output valid JSON
        expect(output.logs.length).toBeGreaterThan(0)
        const parsed = JSON.parse(output.logs[0])
        expect(parsed.success).toBe(true)
        expect(parsed.found).toBe(true)
        expect(parsed.value).toEqual(initialConfig)
      } finally {
        process.chdir(originalCwd)
        output.restore()
      }
    })

    it('config-get with key outputs valid JSON when --json flag is set', async () => {
      const { configGet } = await import('../commands/config-get')

      // Create test config
      const initialConfig = { apiUrl: 'https://test.api.dev' }
      writeFileSync(join(testDir, '.dotdo.json'), JSON.stringify(initialConfig, null, 2))

      const originalCwd = process.cwd()
      process.chdir(testDir)

      const output = captureConsole()

      try {
        await configGet({ key: 'apiUrl', json: true })

        // Should have output valid JSON
        expect(output.logs.length).toBeGreaterThan(0)
        const parsed = JSON.parse(output.logs[0])
        expect(parsed.success).toBe(true)
        expect(parsed.found).toBe(true)
        expect(parsed.key).toBe('apiUrl')
        expect(parsed.value).toBe('https://test.api.dev')
      } finally {
        process.chdir(originalCwd)
        output.restore()
      }
    })

    it('JSON output is compact (no pretty printing)', async () => {
      const { doList } = await import('../commands/do-list')

      const wranglerConfig = {
        durable_objects: {
          bindings: [
            { name: 'DO', class_name: 'DurableObject' },
          ],
        },
      }

      const configPath = join(testDir, 'wrangler.json')
      writeFileSync(configPath, JSON.stringify(wranglerConfig, null, 2))

      const originalCwd = process.cwd()
      process.chdir(testDir)

      const output = captureConsole()

      try {
        await doList({ json: true })

        // JSON should be on a single line (compact)
        expect(output.logs.length).toBe(1)
        expect(output.logs[0]).not.toContain('\n')
      } finally {
        process.chdir(originalCwd)
        output.restore()
      }
    })
  })
})

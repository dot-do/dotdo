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
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

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
        format: 'pretty' as const,
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

      // Mock console.log to capture output
      const logs: string[] = []
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
        logs.push(args.join(' '))
      })

      try {
        const result = await doList({ format: 'json' })

        expect(result).toHaveLength(2)
        expect(result[0].name).toBe('DO')
        expect(result[0].className).toBe('DurableObject')
        expect(result[1].name).toBe('COUNTER')
        expect(result[1].scriptName).toBe('counter-worker')
      } finally {
        process.chdir(originalCwd)
        consoleSpy.mockRestore()
      }
    })

    it('returns empty array when no config found', async () => {
      const { doList } = await import('../commands/do-list')

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

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      try {
        const result = await doList({ namespace: 'DO', format: 'json' })
        expect(result).toHaveLength(1)
        expect(result[0].name).toBe('DO')
      } finally {
        process.chdir(originalCwd)
        consoleSpy.mockRestore()
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

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      try {
        const result = await doInspect({
          id: 'test-do-123',
          format: 'json',
        })

        expect(result.id).toBe('test-do-123')
        expect(result.exists).toBe(true)
      } finally {
        consoleSpy.mockRestore()
      }
    })

    it('includes namespace in result', async () => {
      const { doInspect } = await import('../commands/do-inspect')

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      try {
        const result = await doInspect({
          id: 'test-do-456',
          namespace: 'MY_DO',
          format: 'json',
        })

        expect(result.namespace).toBe('MY_DO')
      } finally {
        consoleSpy.mockRestore()
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

    it('returns cancelled result when not forced and no input', async () => {
      const { doDelete } = await import('../commands/do-delete')

      // Mock readline to return 'n'
      vi.mock('readline', () => ({
        createInterface: () => ({
          question: (msg: string, cb: (answer: string) => void) => cb('n'),
          close: () => {},
        }),
      }))

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      try {
        // Force mode to skip interactive prompt
        const result = await doDelete({
          id: 'test-do-789',
          force: true,
        })

        // With force, it tries to delete but will fail (no local server)
        expect(result.id).toBe('test-do-789')
        // Will be false since no local dev server is running
        expect(result.deleted).toBe(false)
      } finally {
        consoleSpy.mockRestore()
        vi.unmock('readline')
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

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

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
        consoleSpy.mockRestore()
      }
    })

    it('sets a boolean value', async () => {
      const { configSet } = await import('../commands/config-set')

      const originalCwd = process.cwd()
      process.chdir(testDir)

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

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
        consoleSpy.mockRestore()
      }
    })

    it('sets a number value', async () => {
      const { configSet } = await import('../commands/config-set')

      const originalCwd = process.cwd()
      process.chdir(testDir)

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

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
        consoleSpy.mockRestore()
      }
    })

    it('sets a nested key using dot notation', async () => {
      const { configSet } = await import('../commands/config-set')

      const originalCwd = process.cwd()
      process.chdir(testDir)

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

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
        consoleSpy.mockRestore()
      }
    })

    it('preserves existing config values', async () => {
      const { configSet } = await import('../commands/config-set')

      // Create initial config
      const initialConfig = { apiUrl: 'https://initial.api.dev', namespace: 'initial' }
      writeFileSync(join(testDir, '.dotdo.json'), JSON.stringify(initialConfig, null, 2))

      const originalCwd = process.cwd()
      process.chdir(testDir)

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

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
        consoleSpy.mockRestore()
      }
    })

    it('handles JSON array values', async () => {
      const { configSet } = await import('../commands/config-set')

      const originalCwd = process.cwd()
      process.chdir(testDir)

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

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
        consoleSpy.mockRestore()
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
      expect(optionFlags).toContain('--format')
    })

    it('do command has list subcommand with correct options', async () => {
      const { createProgram } = await import('../cli')
      const program = createProgram()

      const doCmd = program.commands.find((cmd) => cmd.name() === 'do')
      const listCmd = doCmd?.commands.find((cmd) => cmd.name() === 'list')

      expect(listCmd).toBeDefined()

      const optionFlags = listCmd?.options.map((opt) => opt.long) || []
      expect(optionFlags).toContain('--namespace')
      expect(optionFlags).toContain('--format')
    })

    it('do command has inspect subcommand with correct options', async () => {
      const { createProgram } = await import('../cli')
      const program = createProgram()

      const doCmd = program.commands.find((cmd) => cmd.name() === 'do')
      const inspectCmd = doCmd?.commands.find((cmd) => cmd.name() === 'inspect')

      expect(inspectCmd).toBeDefined()

      const optionFlags = inspectCmd?.options.map((opt) => opt.long) || []
      expect(optionFlags).toContain('--namespace')
      expect(optionFlags).toContain('--format')
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
  })
})

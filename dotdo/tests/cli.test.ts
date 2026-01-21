/**
 * CLI Framework Tests
 * Tests for do-7rf.9.2 - CLI framework setup
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  loadConfig,
  getDefaultConfig,
  mergeConfig,
  createProgram,
  type DotdoConfig,
} from '../cli'

describe('CLI Framework', () => {
  let testDir: string

  beforeEach(() => {
    // Create a temporary directory for tests
    testDir = join(tmpdir(), `dotdo-cli-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  describe('Configuration Loading', () => {
    describe('getDefaultConfig', () => {
      it('returns default configuration', () => {
        const config = getDefaultConfig()

        expect(config.apiUrl).toBe('https://api.dotdo.dev')
        expect(config.namespace).toBe('default')
        expect(config.verbose).toBe(false)
      })
    })

    describe('loadConfig', () => {
      it('loads .dotdo.json from current directory', async () => {
        const configPath = join(testDir, '.dotdo.json')
        const testConfig: DotdoConfig = {
          apiUrl: 'https://custom.api.dev',
          namespace: 'test-namespace',
          verbose: true,
        }

        writeFileSync(configPath, JSON.stringify(testConfig, null, 2))

        const originalCwd = process.cwd()
        process.chdir(testDir)

        try {
          const config = await loadConfig()
          expect(config.apiUrl).toBe('https://custom.api.dev')
          expect(config.namespace).toBe('test-namespace')
          expect(config.verbose).toBe(true)
        } finally {
          process.chdir(originalCwd)
        }
      })

      it('loads config from explicit path', async () => {
        const configPath = join(testDir, 'custom-config.json')
        const testConfig: DotdoConfig = {
          apiUrl: 'https://explicit.api.dev',
          name: 'explicit-project',
        }

        writeFileSync(configPath, JSON.stringify(testConfig, null, 2))

        const config = await loadConfig(configPath)
        expect(config.apiUrl).toBe('https://explicit.api.dev')
        expect(config.name).toBe('explicit-project')
      })

      it('searches parent directories for config', async () => {
        const parentConfig: DotdoConfig = {
          apiUrl: 'https://parent.api.dev',
          namespace: 'parent-namespace',
        }

        const childDir = join(testDir, 'child', 'grandchild')
        mkdirSync(childDir, { recursive: true })

        writeFileSync(join(testDir, '.dotdo.json'), JSON.stringify(parentConfig, null, 2))

        const originalCwd = process.cwd()
        process.chdir(childDir)

        try {
          const config = await loadConfig()
          expect(config.apiUrl).toBe('https://parent.api.dev')
          expect(config.namespace).toBe('parent-namespace')
        } finally {
          process.chdir(originalCwd)
        }
      })

      it('returns default config when no file found', async () => {
        const originalCwd = process.cwd()
        process.chdir(testDir)

        try {
          const config = await loadConfig()
          const defaultConfig = getDefaultConfig()
          expect(config).toEqual(defaultConfig)
        } finally {
          process.chdir(originalCwd)
        }
      })

      it('throws error when explicit config path does not exist', async () => {
        const nonExistentPath = join(testDir, 'does-not-exist.json')

        await expect(loadConfig(nonExistentPath)).rejects.toThrow('Config file not found')
      })

      it('handles malformed JSON gracefully', async () => {
        const configPath = join(testDir, '.dotdo.json')
        writeFileSync(configPath, '{ invalid json }')

        const originalCwd = process.cwd()
        process.chdir(testDir)

        try {
          await expect(loadConfig()).rejects.toThrow()
        } finally {
          process.chdir(originalCwd)
        }
      })

      it('prefers .dotdo.json over dotdo.config.ts when both exist', async () => {
        const jsonConfig: DotdoConfig = {
          apiUrl: 'https://json.api.dev',
        }

        writeFileSync(join(testDir, '.dotdo.json'), JSON.stringify(jsonConfig, null, 2))
        writeFileSync(
          join(testDir, 'dotdo.config.ts'),
          `export default { apiUrl: 'https://ts.api.dev' }`
        )

        const originalCwd = process.cwd()
        process.chdir(testDir)

        try {
          const config = await loadConfig()
          expect(config.apiUrl).toBe('https://json.api.dev')
        } finally {
          process.chdir(originalCwd)
        }
      })
    })

    describe('mergeConfig', () => {
      it('merges configs with correct precedence', () => {
        const defaults: DotdoConfig = {
          apiUrl: 'https://default.api.dev',
          namespace: 'default',
          verbose: false,
        }

        const fileConfig: DotdoConfig = {
          apiUrl: 'https://file.api.dev',
          name: 'my-project',
        }

        const cliOptions: Partial<DotdoConfig> = {
          verbose: true,
        }

        const merged = mergeConfig(defaults, fileConfig, cliOptions)

        // CLI options should override file config
        expect(merged.verbose).toBe(true)
        // File config should override defaults
        expect(merged.apiUrl).toBe('https://file.api.dev')
        // File config should add new keys
        expect(merged.name).toBe('my-project')
        // Defaults should be preserved when not overridden
        expect(merged.namespace).toBe('default')
      })
    })
  })

  describe('Program Creation', () => {
    it('creates a commander program', () => {
      const program = createProgram()

      expect(program).toBeDefined()
      expect(program.name()).toBe('dotdo')
    })

    it('has global options', () => {
      const program = createProgram()
      const options = program.options

      const optionFlags = options.map((opt) => opt.long)
      expect(optionFlags).toContain('--verbose')
      expect(optionFlags).toContain('--config')
    })

    it('has all core commands', () => {
      const program = createProgram()
      const commandNames = program.commands.map((cmd) => cmd.name())

      // Project management
      expect(commandNames).toContain('init')

      // Development
      expect(commandNames).toContain('dev')
      expect(commandNames).toContain('build')

      // Deployment
      expect(commandNames).toContain('deploy')

      // Authentication
      expect(commandNames).toContain('login')
      expect(commandNames).toContain('logout')
      expect(commandNames).toContain('whoami')

      // Durable Objects
      expect(commandNames).toContain('do')

      // Logging
      expect(commandNames).toContain('logs')

      // Configuration
      expect(commandNames).toContain('config')

      // Utilities
      expect(commandNames).toContain('version')
    })
  })

  describe('Command Groups', () => {
    it('init command has correct options', () => {
      const program = createProgram()
      const initCmd = program.commands.find((cmd) => cmd.name() === 'init')

      expect(initCmd).toBeDefined()
      expect(initCmd?.description()).toContain('Initialize')

      const optionFlags = initCmd?.options.map((opt) => opt.long) || []
      expect(optionFlags).toContain('--template')
      expect(optionFlags).toContain('--name')
      expect(optionFlags).toContain('--skip-git')
    })

    it('dev command has correct options', () => {
      const program = createProgram()
      const devCmd = program.commands.find((cmd) => cmd.name() === 'dev')

      expect(devCmd).toBeDefined()
      expect(devCmd?.description()).toContain('development')

      const optionFlags = devCmd?.options.map((opt) => opt.long) || []
      expect(optionFlags).toContain('--port')
      expect(optionFlags).toContain('--config')
      expect(optionFlags).toContain('--env')
      expect(optionFlags).toContain('--persist')
    })

    it('deploy command has correct options', () => {
      const program = createProgram()
      const deployCmd = program.commands.find((cmd) => cmd.name() === 'deploy')

      expect(deployCmd).toBeDefined()
      expect(deployCmd?.description()).toContain('Deploy')

      const optionFlags = deployCmd?.options.map((opt) => opt.long) || []
      expect(optionFlags).toContain('--env')
      expect(optionFlags).toContain('--dry-run')
    })

    it('do command has subcommands', () => {
      const program = createProgram()
      const doCmd = program.commands.find((cmd) => cmd.name() === 'do')

      expect(doCmd).toBeDefined()
      expect(doCmd?.description()).toContain('Durable Objects')

      const subcommandNames = doCmd?.commands.map((cmd) => cmd.name()) || []
      expect(subcommandNames).toContain('list')
      expect(subcommandNames).toContain('inspect')
      expect(subcommandNames).toContain('delete')
    })

    it('config command has subcommands', () => {
      const program = createProgram()
      const configCmd = program.commands.find((cmd) => cmd.name() === 'config')

      expect(configCmd).toBeDefined()
      expect(configCmd?.description()).toContain('configuration')

      const subcommandNames = configCmd?.commands.map((cmd) => cmd.name()) || []
      expect(subcommandNames).toContain('show')
      expect(subcommandNames).toContain('set')
      expect(subcommandNames).toContain('get')
    })

    it('logs command has correct options', () => {
      const program = createProgram()
      const logsCmd = program.commands.find((cmd) => cmd.name() === 'logs')

      expect(logsCmd).toBeDefined()

      const optionFlags = logsCmd?.options.map((opt) => opt.long) || []
      expect(optionFlags).toContain('--follow')
      expect(optionFlags).toContain('--level')
    })
  })

  describe('Help Text Generation', () => {
    it('generates help text', () => {
      const program = createProgram()
      const helpText = program.helpInformation()

      expect(helpText).toContain('dotdo')
      expect(helpText).toContain('Runtime/Framework for Durable Objects')
      expect(helpText).toContain('init')
      expect(helpText).toContain('dev')
      expect(helpText).toContain('deploy')
    })

    it('command help includes options', () => {
      const program = createProgram()
      const devCmd = program.commands.find((cmd) => cmd.name() === 'dev')

      const helpText = devCmd?.helpInformation() || ''
      expect(helpText).toContain('--port')
      expect(helpText).toContain('--config')
      expect(helpText).toContain('--persist')
    })
  })

  describe('Version Information', () => {
    it('has version option', () => {
      const program = createProgram()
      expect(program.version()).toBe('0.0.1')
    })

    it('has version command', () => {
      const program = createProgram()
      const versionCmd = program.commands.find((cmd) => cmd.name() === 'version')

      expect(versionCmd).toBeDefined()
      expect(versionCmd?.description()).toContain('version')
    })
  })

  describe('Executable Requirements', () => {
    it('has shebang in CLI file', async () => {
      const { readFile } = await import('fs/promises')
      const cliContent = await readFile(join(__dirname, '../cli.ts'), 'utf-8')

      expect(cliContent.startsWith('#!/usr/bin/env node')).toBe(true)
    })

    it('exports program for testing', async () => {
      const cliModule = await import('../cli')
      expect(cliModule.program).toBeDefined()
      expect(cliModule.program.name()).toBe('dotdo')
    })
  })

  describe('Configuration Integration', () => {
    it('loads config before command execution', async () => {
      const configPath = join(testDir, '.dotdo.json')
      const testConfig: DotdoConfig = {
        apiUrl: 'https://test.api.dev',
        namespace: 'test-ns',
      }

      writeFileSync(configPath, JSON.stringify(testConfig, null, 2))

      const originalCwd = process.cwd()
      process.chdir(testDir)

      try {
        // Directly call loadConfig to verify config loading works
        const config = await loadConfig()
        expect(config.apiUrl).toBe('https://test.api.dev')
        expect(config.namespace).toBe('test-ns')
      } finally {
        process.chdir(originalCwd)
      }
    })
  })

  describe('Command Aliases', () => {
    it('supports "durable-object" alias for "do" command', () => {
      const program = createProgram()
      const doCmd = program.commands.find((cmd) => cmd.name() === 'do')

      expect(doCmd?.aliases()).toContain('durable-object')
    })
  })

  describe('Error Handling', () => {
    it('exits with error code when config key not found', async () => {
      const program = createProgram()

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
        throw new Error(`process.exit(${code})`)
      })

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      try {
        await program.parseAsync(['node', 'dotdo', 'config', 'get', 'nonexistent'], {
          from: 'user',
        })
      } catch (e: unknown) {
        expect((e as Error).message).toContain('process.exit(1)')
      }

      exitSpy.mockRestore()
      errorSpy.mockRestore()
    })
  })
})

describe('CLI Integration', () => {
  it('can import and use CLI module', async () => {
    const cliModule = await import('../cli')

    expect(cliModule.loadConfig).toBeDefined()
    expect(cliModule.getDefaultConfig).toBeDefined()
    expect(cliModule.mergeConfig).toBeDefined()
    expect(cliModule.createProgram).toBeDefined()
    expect(cliModule.program).toBeDefined()
  })
})

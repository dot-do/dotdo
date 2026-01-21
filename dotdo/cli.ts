#!/usr/bin/env node
// dotdo CLI - Main CLI Framework
// Implements: do-7rf.9.2 - CLI framework setup

import { Command } from 'commander'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { resolve, join } from 'path'
import { createLogger } from '../utils/logger'

const logger = createLogger('[dotdo]')

/**
 * Configuration type for dotdo CLI and projects
 */
export interface DotdoConfig {
  /** API endpoint for workers.do */
  apiUrl?: string
  /** Default namespace for DOs */
  namespace?: string
  /** Enable verbose logging */
  verbose?: boolean
  /** Path to wrangler.toml */
  wranglerConfig?: string
  /** Project name */
  name?: string
  /** Project version */
  version?: string
  /** Custom environment variables */
  env?: Record<string, string>
}

/**
 * Global options shared across all commands
 */
export interface GlobalOptions {
  verbose?: boolean
  config?: string
}

/**
 * Load configuration from file (.dotdo.json or dotdo.config.ts)
 * Search order:
 * 1. --config flag path
 * 2. .dotdo.json in current directory
 * 3. dotdo.config.ts in current directory
 * 4. .dotdo.json in parent directories (up to project root)
 */
export async function loadConfig(configPath?: string): Promise<DotdoConfig> {
  // If explicit config path provided, use it
  if (configPath) {
    const fullPath = resolve(configPath)
    if (existsSync(fullPath)) {
      return await loadConfigFile(fullPath)
    }
    throw new Error(`Config file not found: ${configPath}`)
  }

  // Search for config in current and parent directories
  let currentDir = process.cwd()
  const root = resolve('/')

  while (currentDir !== root) {
    // Try .dotdo.json
    const jsonPath = join(currentDir, '.dotdo.json')
    if (existsSync(jsonPath)) {
      return await loadConfigFile(jsonPath)
    }

    // Try dotdo.config.ts
    const tsPath = join(currentDir, 'dotdo.config.ts')
    if (existsSync(tsPath)) {
      return await loadConfigFile(tsPath)
    }

    // Move up one directory
    const parentDir = resolve(currentDir, '..')
    if (parentDir === currentDir) break
    currentDir = parentDir
  }

  // Return default config if no file found
  return getDefaultConfig()
}

/**
 * Load and parse a specific config file
 */
async function loadConfigFile(filePath: string): Promise<DotdoConfig> {
  if (filePath.endsWith('.json')) {
    const content = await readFile(filePath, 'utf-8')
    return JSON.parse(content)
  }

  if (filePath.endsWith('.ts') || filePath.endsWith('.js')) {
    // Dynamic import for TypeScript/JavaScript config
    const module = await import(filePath)
    return module.default || module.config || {}
  }

  throw new Error(`Unsupported config file type: ${filePath}`)
}

/**
 * Get default configuration
 */
export function getDefaultConfig(): DotdoConfig {
  return {
    apiUrl: 'https://api.dotdo.dev',
    namespace: 'default',
    verbose: false,
  }
}

/**
 * Merge configurations (CLI options override file config override defaults)
 */
export function mergeConfig(
  defaults: DotdoConfig,
  fileConfig: DotdoConfig,
  cliOptions: Partial<DotdoConfig>
): DotdoConfig {
  return {
    ...defaults,
    ...fileConfig,
    ...cliOptions,
  }
}

/**
 * Create the main CLI program
 */
export function createProgram(): Command {
  const program = new Command()

  program
    .name('dotdo')
    .description('dotdo - Runtime/Framework for Durable Objects')
    .version('0.0.1')
    .option('-v, --verbose', 'Enable verbose logging')
    .option('-c, --config <path>', 'Path to config file (.dotdo.json or dotdo.config.ts)')
    .hook('preAction', async (thisCommand) => {
      // Load config before each command runs
      const opts = thisCommand.opts() as GlobalOptions
      const config = await loadConfig(opts.config)

      if (opts.verbose || config.verbose) {
        logger.debug('[dotdo] Config loaded:', config)
      }

      // Store config on command for access in actions
      ;(thisCommand as any)._dotdoConfig = config
    })

  // ============================================================================
  // Project Management Commands
  // ============================================================================

  program
    .command('init')
    .description('Initialize a new dotdo project')
    .argument('[directory]', 'Target directory (defaults to current directory)')
    .option('-n, --name <name>', 'Project name')
    .option('-y, --yes', 'Skip prompts and use defaults')
    .option('-t, --template <template>', 'Template to use (basic|api|full)', 'basic')
    .option('--skip-git', 'Skip git initialization')
    .option('--skip-install', 'Skip npm install')
    .action(async (directory, options, command) => {
      const config = (command.parent as any)?._dotdoConfig || {}
      if (config.verbose) {
        logger.debug('[dotdo init] Directory:', directory)
        logger.debug('[dotdo init] Options:', options)
      }

      try {
        // Import init command
        const { init } = await import('./commands/init')

        // Run init with options
        await init(directory || '.', {
          name: options.name,
          yes: options.yes,
          template: options.template as 'basic' | 'api' | 'full',
          skipGit: options.skipGit,
          skipInstall: options.skipInstall,
        })
      } catch (error) {
        logger.error('Error:', error instanceof Error ? error.message : error)
        process.exit(1)
      }
    })

  // ============================================================================
  // Development Commands
  // ============================================================================

  program
    .command('dev')
    .description('Start development server')
    .option('-p, --port <number>', 'Port to run on', '8787')
    .option('-c, --config <file>', 'Path to wrangler config file')
    .option('-e, --env <environment>', 'Environment name')
    .option('--inspect', 'Enable debugging with Chrome DevTools')
    .option('--live-reload', 'Enable live reload on file changes')
    .option('--local-protocol <protocol>', 'Protocol to use (http or https)', 'http')
    .option('--persist', 'Enable Durable Object state persistence')
    .option('--verbose', 'Show all wrangler output')
    .action(async (options, command) => {
      const config = (command.parent as any)?._dotdoConfig || {}
      if (config.verbose || options.verbose) {
        logger.debug('[dotdo dev] Options:', options)
        logger.debug('[dotdo dev] Config:', config)
      }

      // Import dev command
      const { devCommand } = await import('./commands/dev')

      // Start dev server
      devCommand({
        port: parseInt(options.port, 10),
        config: options.config,
        env: options.env,
        inspect: options.inspect,
        liveReload: options.liveReload,
        localProtocol: options.localProtocol,
        persist: options.persist,
        verbose: options.verbose || config.verbose,
      })
    })

  program
    .command('build')
    .description('Build project for deployment')
    .option('--minify', 'Minify output')
    .option('--sourcemap', 'Generate sourcemaps')
    .option('-o, --outdir <dir>', 'Output directory')
    .option('-c, --config <file>', 'Path to wrangler config file')
    .option('-e, --env <environment>', 'Environment to build for')
    .action(async (options, command) => {
      const config = (command.parent as any)?._dotdoConfig || {}
      const verbose = config.verbose || options.verbose

      if (verbose) {
        logger.debug('[dotdo build] Options:', options)
      }

      try {
        // Import build command
        const { build } = await import('./commands/build')

        // Run build
        const result = await build({
          minify: options.minify,
          sourcemap: options.sourcemap,
          outdir: options.outdir,
          config: options.config,
          env: options.env,
          verbose,
        })

        if (!result.success) {
          process.exit(result.exitCode)
        }
      } catch (error) {
        logger.error('Build error:', error instanceof Error ? error.message : String(error))
        process.exit(1)
      }
    })

  // ============================================================================
  // Deployment Commands
  // ============================================================================

  program
    .command('deploy')
    .description('Deploy to Cloudflare Workers')
    .option('-e, --env <environment>', 'Environment to deploy to')
    .option('--dry-run', 'Show what would be deployed without deploying')
    .option('--name <name>', 'Worker name')
    .option('--minify', 'Minify the script')
    .option('--config <path>', 'Path to wrangler.toml')
    .option('--rollback <version>', 'Rollback to a specific deployment version')
    .option('--skip-build', 'Skip build step before deployment')
    .allowUnknownOption() // Allow passing through wrangler options
    .action(async (options, command) => {
      const config = (command.parent as any)?._dotdoConfig || {}
      const verbose = config.verbose || options.verbose

      if (verbose) {
        logger.debug('[dotdo deploy] Options:', options)
        logger.debug('[dotdo deploy] Config:', config)
      }

      // Import deploy command
      const { run } = await import('./commands/deploy')

      // Build args array from options
      const args: string[] = []

      if (options.env) {
        args.push('--env', options.env)
      }
      if (options.dryRun) {
        args.push('--dry-run')
      }
      if (options.name) {
        args.push('--name', options.name)
      }
      if (options.minify) {
        args.push('--minify')
      }
      if (options.config) {
        args.push('--config', options.config)
      }
      if (options.rollback) {
        args.push('--rollback', options.rollback)
      }

      // Add any unknown options (passed through to wrangler)
      const processedArgs = process.argv.slice(process.argv.indexOf('deploy') + 1)
      const knownOptions = ['--env', '-e', '--dry-run', '--name', '--minify', '--config', '--rollback', '--skip-build', '-v', '--verbose', '-c']
      for (let i = 0; i < processedArgs.length; i++) {
        const arg = processedArgs[i]
        if (!knownOptions.includes(arg) && !args.includes(arg)) {
          args.push(arg)
          // If the arg takes a value and next arg doesn't start with --, include it
          const nextArg = processedArgs[i + 1]
          if (i + 1 < processedArgs.length && nextArg && !nextArg.startsWith('-')) {
            i++
            args.push(nextArg)
          }
        }
      }

      try {
        const result = await run(args, {
          apiUrl: config.apiUrl,
          verbose,
          skipBuild: options.skipBuild,
        })

        if (!result.success) {
          process.exit(result.exitCode)
        }
      } catch (error) {
        logger.error('Deployment error:', error instanceof Error ? error.message : String(error))
        process.exit(1)
      }
    })

  // ============================================================================
  // Authentication Commands
  // ============================================================================

  program
    .command('login')
    .description('Login via oauth.do')
    .option('--token <token>', 'Use existing token (for CI/CD)')
    .option('--no-browser', 'Do not open browser automatically')
    .action(async (options, command) => {
      const config = (command.parent as any)?._dotdoConfig || {}

      try {
        // Import login command
        const { login } = await import('./commands/login')

        // Run login with options
        await login({
          token: options.token,
          verbose: config.verbose || options.verbose,
          noBrowser: options.noBrowser,
        })
      } catch (error) {
        logger.error('Error:', error instanceof Error ? error.message : error)
        process.exit(1)
      }
    })

  program
    .command('logout')
    .description('Logout and clear credentials')
    .action(async (options, command) => {
      const config = (command.parent as any)?._dotdoConfig || {}

      try {
        // Import logout command
        const { logout } = await import('./commands/logout')

        // Run logout with options
        await logout({
          verbose: config.verbose || options.verbose,
        })
      } catch (error) {
        logger.error('Error:', error instanceof Error ? error.message : error)
        process.exit(1)
      }
    })

  program
    .command('whoami')
    .description('Show current user')
    .option('--json', 'Output as JSON')
    .action(async (options, command) => {
      const config = (command.parent as any)?._dotdoConfig || {}

      try {
        // Import whoami command
        const { whoami } = await import('./commands/whoami')

        // Run whoami with options
        await whoami({
          verbose: config.verbose || options.verbose,
          json: options.json,
        })
      } catch (error) {
        logger.error('Error:', error instanceof Error ? error.message : error)
        process.exit(1)
      }
    })

  // ============================================================================
  // Durable Object Commands
  // ============================================================================

  const doCommand = program
    .command('do')
    .description('Manage Durable Objects')
    .alias('durable-object')

  doCommand
    .command('list')
    .description('List Durable Object bindings from wrangler configuration')
    .option('-n, --namespace <name>', 'Filter by namespace/binding name')
    .option('-c, --config <file>', 'Path to wrangler config file')
    .option('--format <format>', 'Output format (table|json)', 'table')
    .action(async (options, command) => {
      const config = (command.parent?.parent as any)?._dotdoConfig || {}
      const verbose = config.verbose || options.verbose

      if (verbose) {
        logger.debug('[dotdo do list] Options:', options)
      }

      try {
        // Import do list command
        const { doList } = await import('./commands/do-list')

        // Run do list
        await doList({
          namespace: options.namespace,
          config: options.config,
          format: options.format,
          verbose,
        })
      } catch (error) {
        logger.error('Error:', error instanceof Error ? error.message : String(error))
        process.exit(1)
      }
    })

  doCommand
    .command('inspect <id>')
    .description('Inspect a Durable Object\'s state and metadata')
    .option('-n, --namespace <name>', 'Namespace/binding name')
    .option('-c, --config <file>', 'Path to wrangler config file')
    .option('--format <format>', 'Output format (table|json)', 'table')
    .option('--storage', 'Show storage contents', true)
    .action(async (id, options, command) => {
      const config = (command.parent?.parent as any)?._dotdoConfig || {}
      const verbose = config.verbose || options.verbose

      if (verbose) {
        logger.debug('[dotdo do inspect] Options:', options)
      }

      try {
        // Import do inspect command
        const { doInspect } = await import('./commands/do-inspect')

        // Run do inspect
        await doInspect({
          id,
          namespace: options.namespace,
          config: options.config,
          format: options.format,
          storage: options.storage,
          verbose,
        })
      } catch (error) {
        logger.error('Error:', error instanceof Error ? error.message : String(error))
        process.exit(1)
      }
    })

  doCommand
    .command('delete <id>')
    .description('Delete a Durable Object\'s storage')
    .option('-f, --force', 'Skip confirmation prompt')
    .option('-n, --namespace <name>', 'Namespace/binding name')
    .option('-c, --config <file>', 'Path to wrangler config file')
    .action(async (id, options, command) => {
      const config = (command.parent?.parent as any)?._dotdoConfig || {}
      const verbose = config.verbose || options.verbose

      if (verbose) {
        logger.debug('[dotdo do delete] Options:', options)
      }

      try {
        // Import do delete command
        const { doDelete } = await import('./commands/do-delete')

        // Run do delete
        const result = await doDelete({
          id,
          namespace: options.namespace,
          force: options.force,
          config: options.config,
          verbose,
        })

        if (!result.deleted) {
          // Exit with non-zero if deletion was cancelled or failed
          process.exit(1)
        }
      } catch (error) {
        logger.error('Error:', error instanceof Error ? error.message : String(error))
        process.exit(1)
      }
    })

  // ============================================================================
  // Logging & Monitoring
  // ============================================================================

  program
    .command('logs')
    .description('Tail logs from deployed worker')
    .option('-f, --follow', 'Follow logs in real-time', true)
    .option('--level <level>', 'Filter by log level (debug|info|warn|error)', 'info')
    .option('-n, --name <name>', 'Worker name (defaults to wrangler.toml name)')
    .option('-e, --env <environment>', 'Environment to target')
    .option('-c, --config <file>', 'Path to wrangler config file')
    .option('--format <format>', 'Output format (json|pretty)', 'pretty')
    .action(async (options, command) => {
      const config = (command.parent as any)?._dotdoConfig || {}
      const verbose = config.verbose || options.verbose

      if (verbose) {
        logger.debug('[dotdo logs] Options:', options)
      }

      try {
        // Import logs command
        const { logs } = await import('./commands/logs')

        // Run logs
        await logs({
          follow: options.follow,
          level: options.level,
          name: options.name,
          env: options.env,
          config: options.config,
          format: options.format,
          verbose,
        })
      } catch (error) {
        logger.error('Logs error:', error instanceof Error ? error.message : String(error))
        process.exit(1)
      }
    })

  // ============================================================================
  // Configuration Commands
  // ============================================================================

  const configCommand = program
    .command('config')
    .description('Manage configuration')

  configCommand
    .command('show')
    .description('Show current configuration')
    .action(async (options, command) => {
      const config = (command.parent?.parent as any)?._dotdoConfig || {}
      logger.info('Current dotdo configuration:')
      logger.info(JSON.stringify(config, null, 2))
    })

  configCommand
    .command('set <key> <value>')
    .description('Set a configuration value')
    .option('-g, --global', 'Use global config (~/.dotdo/config.json)')
    .action(async (key, value, options, command) => {
      const config = (command.parent?.parent as any)?._dotdoConfig || {}
      const verbose = config.verbose || options.verbose

      if (verbose) {
        logger.debug('[dotdo config set] Key:', key)
        logger.debug('[dotdo config set] Value:', value)
        logger.debug('[dotdo config set] Options:', options)
      }

      try {
        // Import config set command
        const { configSet } = await import('./commands/config-set')

        // Run config set
        await configSet({
          key,
          value,
          global: options.global,
          verbose,
        })
      } catch (error) {
        logger.error('Error:', error instanceof Error ? error.message : String(error))
        process.exit(1)
      }
    })

  configCommand
    .command('get [key]')
    .description('Get a configuration value')
    .option('-g, --global', 'Use global config (~/.dotdo/config.json)')
    .action(async (key, options, command) => {
      const config = (command.parent?.parent as any)?._dotdoConfig || {}
      const verbose = config.verbose || options.verbose

      if (verbose) {
        logger.debug('[dotdo config get] Key:', key)
        logger.debug('[dotdo config get] Options:', options)
      }

      try {
        // Import config get command
        const { configGet } = await import('./commands/config-get')

        // Run config get
        const result = await configGet({
          key,
          global: options.global,
          verbose,
        })

        if (!result.found && key) {
          process.exit(1)
        }
      } catch (error) {
        logger.error('Error:', error instanceof Error ? error.message : String(error))
        process.exit(1)
      }
    })

  // ============================================================================
  // Utility Commands
  // ============================================================================

  program
    .command('version')
    .description('Show version information')
    .action(() => {
      logger.info('dotdo version 0.0.1')
      logger.info('Runtime/Framework for Durable Objects')
    })

  return program
}

// ============================================================================
// Main Entry Point
// ============================================================================

// Create and export program for testing
export const program = createProgram()

// Only run if this is the main module (ES module compatible)
const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url === `file://${process.argv[1]}.ts`

if (isMain) {
  program.parse()
}

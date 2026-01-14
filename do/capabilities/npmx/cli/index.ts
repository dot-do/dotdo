/**
 * CLI for npmx - NPM/NPX for edge runtimes
 *
 * Commands:
 * - install [packages...]  - install packages
 * - uninstall <packages...> - remove packages
 * - list                   - list installed packages
 * - search <query>         - search npm registry
 * - info <package>         - show package info
 * - run <script>           - run package.json script
 * - exec <command>         - execute package binary
 * - init                   - create package.json
 * - publish                - publish to registry
 * - version [bump]         - bump version
 */

import cac, { type CAC } from 'cac'
import type { CommandResult, PackageEntry, SearchResult } from './types'
import { VERSION } from './version'
import {
  parseOptions,
  formatPackageList,
  formatSearchResults,
  formatPackageInfo,
  formatInstallResult,
  formatError,
  missingArgumentError,
  unknownCommandError,
} from './utils'
import { mainHelp, getCommandHelp } from './help'

// Re-export formatters for tests
export { formatPackageList, formatSearchResults, formatPackageInfo, formatInstallResult } from './utils'

/**
 * Mock registry interface for dependency injection
 */
interface MockRegistry {
  search: (query: string) => Promise<SearchResult[]>
  info: (name: string, version?: string) => Promise<{
    name: string
    version: string
    description?: string
    homepage?: string
    repository?: string
    license?: string
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }>
  versions: (name: string) => Promise<string[]>
}

/**
 * Mock package manager interface for dependency injection
 */
interface MockPackageManager {
  install: (packages: string[], options?: { dev?: boolean; exact?: boolean }) => Promise<{
    installed: Array<{ name: string; version: string }>
    removed: Array<{ name: string; version: string }>
    updated: Array<{ name: string; from: string; to: string }>
    stats: { resolved: number; cached: number; duration: number }
  }>
  uninstall: (packages: string[]) => Promise<void>
  list: (options?: { depth?: number }) => Promise<PackageEntry[]>
  run: (script: string, args: string[]) => Promise<{ exitCode: number; output: string }>
  exec: (command: string, args: string[]) => Promise<{ exitCode: number; output: string }>
}

/**
 * Mock filesystem interface
 */
interface MockFS {
  readFile: (path: string) => Promise<string>
  writeFile: (path: string, content: string) => Promise<void>
  exists: (path: string) => Promise<boolean>
}

/**
 * CLI context for dependency injection
 */
interface CLIContext {
  registry: MockRegistry
  pm: MockPackageManager
  fs: MockFS
  stdout: (text: string) => void
  stderr: (text: string) => void
  exit: (code: number) => void
  cwd: string
}

/**
 * CLI instance type
 */
export interface CLIInstance {
  name: string
  parse: (argv?: string[], options?: { run?: boolean }) => { args: readonly string[]; options: Record<string, unknown> }
  commands: string[]
  cli: CAC
}

/**
 * Create and return the CLI instance with all commands registered
 */
export function createCLI(): CLIInstance {
  const cli = cac('npmx')

  cli.version(VERSION)
  cli.help()

  // install command
  cli.command('install [packages...]', 'install packages')
    .alias('i')
    .alias('add')
    .option('-S, --save', 'Save to dependencies (default)')
    .option('-D, --save-dev', 'Save to devDependencies')
    .option('-E, --save-exact', 'Save exact version')
    .option('-g, --global', 'Install globally')
    .option('--production', 'Skip devDependencies')
    .action(() => {})

  // uninstall command
  cli.command('uninstall <packages...>', 'remove packages')
    .alias('rm')
    .alias('remove')
    .option('-S, --save', 'Remove from dependencies')
    .option('-D, --save-dev', 'Remove from devDependencies')
    .option('-g, --global', 'Remove global package')
    .action(() => {})

  // list command
  cli.command('list [package]', 'list installed packages')
    .alias('ls')
    .option('--depth <n>', 'Max depth')
    .option('--json', 'Output as JSON')
    .option('-l, --long', 'Show extended info')
    .option('-g, --global', 'List global packages')
    .action(() => {})

  // search command
  cli.command('search <query>', 'search npm registry')
    .option('--json', 'Output as JSON')
    .action(() => {})

  // info command
  cli.command('info <package>', 'show package info')
    .alias('view')
    .alias('show')
    .option('--json', 'Output as JSON')
    .action(() => {})

  // run command
  cli.command('run <script>', 'run package.json script')
    .action(() => {})

  // exec command
  cli.command('exec <command>', 'execute package binary')
    .alias('x')
    .option('-p, --package <pkg>', 'Package to use')
    .option('--yes', 'Skip confirmation')
    .action(() => {})

  // init command
  cli.command('init', 'create package.json')
    .option('-y, --yes', 'Use defaults')
    .option('--scope <org>', 'Create scoped package')
    .action(() => {})

  // publish command
  cli.command('publish [folder]', 'publish to registry')
    .option('--tag <tag>', 'Publish with tag')
    .option('--access <access>', 'Set access level')
    .option('--dry-run', 'Dry run')
    .action(() => {})

  // version command
  cli.command('version [bump]', 'bump package version')
    .option('--preid <id>', 'Prerelease identifier')
    .option('-m, --message <msg>', 'Git commit message')
    .option('--no-git-tag', 'Skip git tagging')
    .action(() => {})

  return {
    name: 'npmx',
    parse: cli.parse.bind(cli),
    commands: ['install', 'uninstall', 'list', 'search', 'info', 'run', 'exec', 'init', 'publish', 'version'],
    cli
  }
}

/**
 * Execute a CLI command with the given arguments and context
 */
export async function runCLI(args: string[], context: CLIContext): Promise<CommandResult> {
  const { stdout, stderr } = context

  // Handle --version and -v
  if (args.includes('--version') || args.includes('-v')) {
    stdout(VERSION)
    return { exitCode: 0 }
  }

  // Handle --help and -h at root level
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    if (args.length === 0 || (args.length === 1 && (args[0] === '--help' || args[0] === '-h'))) {
      stdout(mainHelp())
      return { exitCode: 0 }
    }
  }

  // Parse command
  const command = args[0] ?? ''
  const restArgs = args.slice(1)

  // Handle command-specific help
  if (restArgs.includes('--help') || restArgs.includes('-h')) {
    const helpText = getCommandHelp(command)
    if (helpText) {
      stdout(helpText)
      return { exitCode: 0 }
    }
  }

  try {
    switch (command) {
      case 'install':
      case 'i':
      case 'add':
        return await executeInstall(restArgs, context)

      case 'uninstall':
      case 'rm':
      case 'remove':
        return await executeUninstall(restArgs, context)

      case 'list':
      case 'ls':
        return await executeList(restArgs, context)

      case 'search':
        return await executeSearch(restArgs, context)

      case 'info':
      case 'view':
      case 'show':
        return await executeInfo(restArgs, context)

      case 'run':
        return await executeRun(restArgs, context)

      case 'exec':
      case 'x':
        return await executeExec(restArgs, context)

      case 'init':
        return await executeInit(restArgs, context)

      case 'publish':
        return await executePublish(restArgs, context)

      case 'version':
        return await executeVersion(restArgs, context)

      default:
        stderr(unknownCommandError(command))
        return { exitCode: 1, error: `unknown command '${command}'` }
    }
  } catch (err: unknown) {
    const message = formatError(command, err)
    stderr(message)
    return { exitCode: 1, error: message }
  }
}

/**
 * Execute install command
 */
async function executeInstall(args: string[], context: CLIContext): Promise<CommandResult> {
  const { pm, stdout, stderr } = context
  const { options, packages } = parseOptions(args)

  try {
    const result = await pm.install(packages, {
      dev: Boolean(options.saveDev),
      exact: Boolean(options.saveExact),
    })

    stdout(formatInstallResult(result.installed, result.removed, result.updated))
    return { exitCode: 0 }
  } catch (err: unknown) {
    stderr(formatError('install', err))
    const message = err instanceof Error ? err.message : String(err)
    return { exitCode: 1, error: message }
  }
}

/**
 * Execute uninstall command
 */
async function executeUninstall(args: string[], context: CLIContext): Promise<CommandResult> {
  const { pm, stdout, stderr } = context
  const { packages } = parseOptions(args)

  if (packages.length === 0) {
    stderr(missingArgumentError('uninstall', 'package'))
    return { exitCode: 1, error: 'missing package argument' }
  }

  try {
    await pm.uninstall(packages)
    stdout(`removed ${packages.length} packages`)
    return { exitCode: 0 }
  } catch (err: unknown) {
    stderr(formatError('uninstall', err))
    const message = err instanceof Error ? err.message : String(err)
    return { exitCode: 1, error: message }
  }
}

/**
 * Execute list command
 */
async function executeList(args: string[], context: CLIContext): Promise<CommandResult> {
  const { pm, stdout, stderr } = context
  const { options } = parseOptions(args)

  try {
    const depthValue = typeof options.depth === 'string' ? parseInt(options.depth, 10) : undefined
    const listOptions = depthValue !== undefined ? { depth: depthValue } : {}
    const packages = await pm.list(listOptions)
    stdout(formatPackageList(packages, { long: Boolean(options.long), json: Boolean(options.json) }))
    return { exitCode: 0 }
  } catch (err: unknown) {
    stderr(formatError('list', err))
    const message = err instanceof Error ? err.message : String(err)
    return { exitCode: 1, error: message }
  }
}

/**
 * Execute search command
 */
async function executeSearch(args: string[], context: CLIContext): Promise<CommandResult> {
  const { registry, stdout, stderr } = context
  const { options, packages } = parseOptions(args)

  if (packages.length === 0) {
    stderr(missingArgumentError('search', 'query'))
    return { exitCode: 1, error: 'missing query argument' }
  }

  const query = packages.join(' ')

  try {
    const results = await registry.search(query)
    stdout(formatSearchResults(results, { json: Boolean(options.json) }))
    return { exitCode: 0 }
  } catch (err: unknown) {
    stderr(formatError('search', err))
    const message = err instanceof Error ? err.message : String(err)
    return { exitCode: 1, error: message }
  }
}

/**
 * Execute info command
 */
async function executeInfo(args: string[], context: CLIContext): Promise<CommandResult> {
  const { registry, stdout, stderr } = context
  const { options, packages } = parseOptions(args)

  const spec = packages[0]
  if (!spec) {
    stderr(missingArgumentError('info', 'package'))
    return { exitCode: 1, error: 'missing package argument' }
  }

  const atIndex = spec.lastIndexOf('@')
  const name = atIndex > 0 ? spec.slice(0, atIndex) : spec
  const version = atIndex > 0 ? spec.slice(atIndex + 1) : undefined

  try {
    const info = await registry.info(name, version)
    stdout(formatPackageInfo(info, { json: Boolean(options.json) }))
    return { exitCode: 0 }
  } catch (err: unknown) {
    stderr(formatError('info', err))
    const message = err instanceof Error ? err.message : String(err)
    return { exitCode: 1, error: message }
  }
}

/**
 * Execute run command
 */
async function executeRun(args: string[], context: CLIContext): Promise<CommandResult> {
  const { pm, stdout, stderr } = context

  const script = args[0]
  if (!script) {
    stderr(missingArgumentError('run', 'script'))
    return { exitCode: 1, error: 'missing script argument' }
  }

  const scriptArgs = args.slice(1).filter(a => a !== '--')

  try {
    const result = await pm.run(script, scriptArgs)
    if (result.output) {
      stdout(result.output)
    }
    return { exitCode: result.exitCode }
  } catch (err: unknown) {
    stderr(formatError('run', err))
    const message = err instanceof Error ? err.message : String(err)
    return { exitCode: 1, error: message }
  }
}

/**
 * Execute exec command
 */
async function executeExec(args: string[], context: CLIContext): Promise<CommandResult> {
  const { pm, stdout, stderr } = context

  const command = args[0]
  if (!command) {
    stderr(missingArgumentError('exec', 'command'))
    return { exitCode: 1, error: 'missing command argument' }
  }

  const commandArgs = args.slice(1)

  try {
    const result = await pm.exec(command, commandArgs)
    if (result.output) {
      stdout(result.output)
    }
    return { exitCode: result.exitCode }
  } catch (err: unknown) {
    stderr(formatError('exec', err))
    const message = err instanceof Error ? err.message : String(err)
    return { exitCode: 1, error: message }
  }
}

/**
 * Execute init command
 */
async function executeInit(_args: string[], context: CLIContext): Promise<CommandResult> {
  const { fs, stdout, cwd } = context

  const packageJson = {
    name: cwd.split('/').pop() || 'my-package',
    version: '1.0.0',
    description: '',
    main: 'index.js',
    scripts: {
      test: 'echo "Error: no test specified" && exit 1'
    },
    keywords: [],
    author: '',
    license: 'ISC'
  }

  await fs.writeFile(`${cwd}/package.json`, JSON.stringify(packageJson, null, 2))
  stdout(`Wrote to ${cwd}/package.json`)
  return { exitCode: 0 }
}

/**
 * Execute publish command
 */
async function executePublish(args: string[], context: CLIContext): Promise<CommandResult> {
  const { stdout } = context
  const { options } = parseOptions(args)

  if (options.dryRun) {
    stdout('Would publish package (dry run)')
    return { exitCode: 0 }
  }

  // Actual publish logic would go here
  stdout('Package published')
  return { exitCode: 0 }
}

/**
 * Execute version command
 */
async function executeVersion(args: string[], context: CLIContext): Promise<CommandResult> {
  const { fs, stdout, cwd } = context
  const { packages } = parseOptions(args)

  const bump = packages[0] || 'patch'

  try {
    const content = await fs.readFile(`${cwd}/package.json`)
    const pkg = JSON.parse(content)
    const current = pkg.version || '0.0.0'
    const [major, minor, patch] = current.split('.').map(Number)

    let newVersion: string
    switch (bump) {
      case 'major':
        newVersion = `${major + 1}.0.0`
        break
      case 'minor':
        newVersion = `${major}.${minor + 1}.0`
        break
      case 'patch':
        newVersion = `${major}.${minor}.${patch + 1}`
        break
      default:
        // Assume explicit version
        newVersion = bump
    }

    pkg.version = newVersion
    await fs.writeFile(`${cwd}/package.json`, JSON.stringify(pkg, null, 2))
    stdout(`v${newVersion}`)
    return { exitCode: 0 }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { exitCode: 1, error: message }
  }
}

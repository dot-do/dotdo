/**
 * CLI - Command-line interface
 *
 * Represents a CLI tool with commands, arguments, and execution.
 * Examples: 'bd', 'wrangler', 'npm'
 */

import { Package, PackageConfig, PackageVersion } from '../entities/Package'
import { Env } from '../core/DO'

export interface CLICommand {
  name: string
  description: string
  aliases?: string[]
  arguments?: CLIArgument[]
  options?: CLIOption[]
  subcommands?: CLICommand[]
  handler?: string
}

export interface CLIArgument {
  name: string
  description: string
  required: boolean
  type: 'string' | 'number' | 'boolean'
  default?: unknown
}

export interface CLIOption {
  name: string
  short?: string
  description: string
  type: 'string' | 'number' | 'boolean'
  default?: unknown
  required?: boolean
}

export interface CLIConfig extends PackageConfig {
  bin: string
  commands: CLICommand[]
  globalOptions?: CLIOption[]
}

export interface CLIExecution {
  id: string
  command: string
  args: string[]
  options: Record<string, unknown>
  output?: string
  exitCode?: number
  startedAt: Date
  completedAt?: Date
}

export class CLI extends Package {
  private cliConfig: CLIConfig | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  /**
   * Get CLI configuration
   */
  async getCLIConfig(): Promise<CLIConfig | null> {
    if (!this.cliConfig) {
      this.cliConfig = (await this.ctx.storage.get('cli_config')) as CLIConfig | null
    }
    return this.cliConfig
  }

  /**
   * Configure the CLI
   */
  async configureCLI(config: CLIConfig): Promise<void> {
    this.cliConfig = config
    await this.ctx.storage.put('cli_config', config)
    await this.configure(config)
    await this.emit('cli.configured', { config })
  }

  /**
   * Find command by name
   */
  findCommand(name: string, commands?: CLICommand[]): CLICommand | null {
    const cmds = commands || this.cliConfig?.commands || []

    for (const cmd of cmds) {
      if (cmd.name === name || cmd.aliases?.includes(name)) {
        return cmd
      }
      if (cmd.subcommands) {
        const sub = this.findCommand(name, cmd.subcommands)
        if (sub) return sub
      }
    }

    return null
  }

  /**
   * Parse command-line arguments
   */
  parseArgs(args: string[]): { command: string; args: string[]; options: Record<string, unknown> } {
    const options: Record<string, unknown> = {}
    const positional: string[] = []
    let command = ''

    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!

      if (arg.startsWith('--')) {
        const key = arg.slice(2)
        const nextArg = args[i + 1]

        if (nextArg && !nextArg.startsWith('-')) {
          options[key] = nextArg
          i++
        } else {
          options[key] = true
        }
      } else if (arg.startsWith('-')) {
        const key = arg.slice(1)
        const nextArg = args[i + 1]

        if (nextArg && !nextArg.startsWith('-')) {
          options[key] = nextArg
          i++
        } else {
          options[key] = true
        }
      } else {
        if (!command) {
          command = arg
        } else {
          positional.push(arg)
        }
      }
    }

    return { command, args: positional, options }
  }

  /**
   * Execute a command
   */
  async execute(args: string[]): Promise<CLIExecution> {
    const parsed = this.parseArgs(args)
    const execution: CLIExecution = {
      id: crypto.randomUUID(),
      command: parsed.command,
      args: parsed.args,
      options: parsed.options,
      startedAt: new Date(),
    }

    await this.emit('cli.executing', { execution })

    try {
      const cmd = this.findCommand(parsed.command)
      if (!cmd) {
        execution.output = `Unknown command: ${parsed.command}`
        execution.exitCode = 1
      } else {
        // In production, execute the handler
        execution.output = await this.executeHandler(cmd, parsed.args, parsed.options)
        execution.exitCode = 0
      }
    } catch (error) {
      execution.output = error instanceof Error ? error.message : String(error)
      execution.exitCode = 1
    }

    execution.completedAt = new Date()
    await this.ctx.storage.put(`execution:${execution.id}`, execution)
    await this.emit('cli.executed', { execution })

    return execution
  }

  /**
   * Execute command handler (stub)
   */
  protected async executeHandler(cmd: CLICommand, args: string[], options: Record<string, unknown>): Promise<string> {
    // Override in subclasses for actual command execution
    return `Executed: ${cmd.name} ${args.join(' ')}\nOptions: ${JSON.stringify(options)}`
  }

  /**
   * Generate help text
   */
  generateHelp(commandName?: string): string {
    const config = this.cliConfig
    if (!config) return 'CLI not configured'

    if (commandName) {
      const cmd = this.findCommand(commandName)
      if (!cmd) return `Unknown command: ${commandName}`

      let help = `${cmd.name} - ${cmd.description}\n\n`

      if (cmd.arguments?.length) {
        help += 'Arguments:\n'
        for (const arg of cmd.arguments) {
          help += `  ${arg.name}${arg.required ? ' (required)' : ''} - ${arg.description}\n`
        }
        help += '\n'
      }

      if (cmd.options?.length) {
        help += 'Options:\n'
        for (const opt of cmd.options) {
          const short = opt.short ? `-${opt.short}, ` : ''
          help += `  ${short}--${opt.name} - ${opt.description}\n`
        }
      }

      return help
    }

    let help = `${config.name}\n${config.description || ''}\n\nCommands:\n`

    for (const cmd of config.commands) {
      help += `  ${cmd.name} - ${cmd.description}\n`
    }

    if (config.globalOptions?.length) {
      help += '\nGlobal Options:\n'
      for (const opt of config.globalOptions) {
        const short = opt.short ? `-${opt.short}, ` : ''
        help += `  ${short}--${opt.name} - ${opt.description}\n`
      }
    }

    return help
  }

  /**
   * Get execution history
   */
  async getExecutionHistory(limit: number = 10): Promise<CLIExecution[]> {
    const map = await this.ctx.storage.list({ prefix: 'execution:' })
    const executions = Array.from(map.values()) as CLIExecution[]
    return executions.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime()).slice(0, limit)
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/cli/config') {
      if (request.method === 'GET') {
        const config = await this.getCLIConfig()
        return new Response(JSON.stringify(config), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (request.method === 'PUT') {
        const config = (await request.json()) as CLIConfig
        await this.configureCLI(config)
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    if (url.pathname === '/cli/execute' && request.method === 'POST') {
      const { args } = (await request.json()) as { args: string[] }
      const execution = await this.execute(args)
      return new Response(JSON.stringify(execution), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/cli/help') {
      const command = url.searchParams.get('command') || undefined
      const help = this.generateHelp(command)
      return new Response(help, {
        headers: { 'Content-Type': 'text/plain' },
      })
    }

    if (url.pathname === '/cli/history') {
      const history = await this.getExecutionHistory()
      return new Response(JSON.stringify(history), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return super.fetch(request)
  }
}

export default CLI

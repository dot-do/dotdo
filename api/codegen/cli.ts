// CLI command generation from API schema
// Implements: do-7rf.7.6 - CLI command generation for @dotdo/api

import type { ResourceDefinition, ActionDef, RelationDef } from '../resource'
import type { StorableData, JsonValue } from '@dotdo/db'

/**
 * Options for CLI generation
 */
export interface CLIGeneratorOptions {
  /** Output format: typescript code or json structure */
  format?: 'typescript' | 'json'
  /** Base URL for API requests */
  baseUrl?: string
  /** Command prefix (e.g., 'dotdo', 'myapp') */
  commandPrefix?: string
}

/**
 * CLI command structure
 */
export interface CLICommand {
  name: string
  description: string
  arguments?: CLIArgument[]
  options?: CLIOption[]
  subcommands?: CLICommand[]
  examples?: string[]
  handler?: string // Code for the handler function
}

/**
 * CLI argument (positional)
 */
export interface CLIArgument {
  name: string
  description: string
  required: boolean
  type?: string
}

/**
 * CLI option (flag)
 */
export interface CLIOption {
  name: string
  description: string
  type: string
  required: boolean
  default?: JsonValue
  choices?: string[]
}

/**
 * CLI structure returned when format is 'json'
 */
export interface CLIStructure {
  commands: CLICommand[]
}

/**
 * Generate CLI commands from resource definitions
 */
export function generateCLI<T extends StorableData = StorableData>(
  resources: ResourceDefinition<T>[],
  options?: CLIGeneratorOptions
): CLIStructure | string {
  const format = options?.format
  const baseUrl = options?.baseUrl || 'https://api.dotdo.dev'
  const commandPrefix = options?.commandPrefix || 'dotdo'

  // Build CLI structure
  const structure: CLIStructure = {
    commands: resources.map((resource) => generateResourceCommand(resource)),
  }

  // Return based on format
  if (format === 'json') {
    return JSON.stringify(structure, null, 2)
  } else if (format === 'typescript') {
    return generateTypeScriptCode(structure, { baseUrl, commandPrefix })
  }

  // Default: return structure object
  return structure
}

/**
 * Generate a command for a single resource
 */
function generateResourceCommand<T extends StorableData>(resource: ResourceDefinition<T>): CLICommand {
  const resourceNamePlural = pluralize(resource.name.toLowerCase())

  const subcommands: CLICommand[] = [
    // CRUD commands
    generateListCommand(resource),
    generateGetCommand(resource),
    generateCreateCommand(resource),
    generateUpdateCommand(resource),
    generateDeleteCommand(resource),
  ]

  // Add custom action commands
  if (resource.actions) {
    for (const [actionName, actionDef] of Object.entries(resource.actions)) {
      subcommands.push(generateActionCommand(resource, actionName, actionDef))
    }
  }

  // Add relation commands
  if (resource.relations) {
    for (const [relationName, relationDef] of Object.entries(resource.relations)) {
      subcommands.push(generateRelationCommand(resource, relationName, relationDef))
    }
  }

  return {
    name: resourceNamePlural,
    description: `Manage ${resource.name} resources`,
    subcommands,
  }
}

/**
 * Generate list command
 */
function generateListCommand<T extends StorableData>(resource: ResourceDefinition<T>): CLICommand {
  return {
    name: 'list',
    description: `List all ${resource.name} resources`,
    options: [
      {
        name: 'format',
        description: 'Output format',
        type: 'enum',
        required: false,
        default: 'table',
        choices: ['json', 'table', 'yaml'],
      },
      {
        name: 'limit',
        description: 'Maximum number of items to return',
        type: 'number',
        required: false,
      },
      {
        name: 'offset',
        description: 'Number of items to skip',
        type: 'number',
        required: false,
      },
    ],
    examples: [
      `dotdo ${pluralize(resource.name.toLowerCase())} list`,
      `dotdo ${pluralize(resource.name.toLowerCase())} list --format json`,
      `dotdo ${pluralize(resource.name.toLowerCase())} list --limit 10`,
    ],
    handler: `async (options) => {
  const response = await client.${pluralize(resource.name.toLowerCase())}.list(options)
  formatOutput(response, options.format)
}`,
  }
}

/**
 * Generate get command
 */
function generateGetCommand<T extends StorableData>(resource: ResourceDefinition<T>): CLICommand {
  return {
    name: 'get',
    description: `Get a ${resource.name} by ID`,
    arguments: [
      {
        name: 'id',
        description: `${resource.name} ID`,
        required: true,
        type: 'string',
      },
    ],
    options: [
      {
        name: 'format',
        description: 'Output format',
        type: 'enum',
        required: false,
        default: 'table',
        choices: ['json', 'table', 'yaml'],
      },
    ],
    examples: [
      `dotdo ${pluralize(resource.name.toLowerCase())} get <id>`,
      `dotdo ${pluralize(resource.name.toLowerCase())} get <id> --format json`,
    ],
    handler: `async (id, options) => {
  const response = await client.${pluralize(resource.name.toLowerCase())}.get(id)
  formatOutput(response, options.format)
}`,
  }
}

/**
 * Generate create command
 */
function generateCreateCommand<T extends StorableData>(resource: ResourceDefinition<T>): CLICommand {
  const options: CLIOption[] = []

  // Generate options from fields
  for (const [fieldName, fieldDef] of Object.entries(resource.fields)) {
    const choices = fieldDef.type === 'enum' ? getEnumChoices(resource, fieldName) : undefined
    options.push({
      name: fieldName,
      description: `${fieldName} field`,
      type: fieldDef.type,
      required: fieldDef.required || false,
      ...(choices !== undefined && { choices }),
    })
  }

  // Add format option
  options.push({
    name: 'format',
    description: 'Output format',
    type: 'enum',
    required: false,
    default: 'table',
    choices: ['json', 'table', 'yaml'],
  })

  return {
    name: 'create',
    description: `Create a new ${resource.name}`,
    options,
    examples: [
      `dotdo ${pluralize(resource.name.toLowerCase())} create --name "Example" --email "user@example.com"`,
      `dotdo ${pluralize(resource.name.toLowerCase())} create --name "Example" --format json`,
    ],
    handler: `async (options) => {
  const { format, ...data } = options
  const response = await client.${pluralize(resource.name.toLowerCase())}.create(data)
  formatOutput(response, format)
}`,
  }
}

/**
 * Generate update command
 */
function generateUpdateCommand<T extends StorableData>(resource: ResourceDefinition<T>): CLICommand {
  const options: CLIOption[] = []

  // Generate options from fields (all optional for update)
  for (const [fieldName, fieldDef] of Object.entries(resource.fields)) {
    const choices = fieldDef.type === 'enum' ? getEnumChoices(resource, fieldName) : undefined
    options.push({
      name: fieldName,
      description: `${fieldName} field`,
      type: fieldDef.type,
      required: false,
      ...(choices !== undefined && { choices }),
    })
  }

  // Add format option
  options.push({
    name: 'format',
    description: 'Output format',
    type: 'enum',
    required: false,
    default: 'table',
    choices: ['json', 'table', 'yaml'],
  })

  return {
    name: 'update',
    description: `Update a ${resource.name}`,
    arguments: [
      {
        name: 'id',
        description: `${resource.name} ID`,
        required: true,
        type: 'string',
      },
    ],
    options,
    examples: [
      `dotdo ${pluralize(resource.name.toLowerCase())} update <id> --name "New Name"`,
      `dotdo ${pluralize(resource.name.toLowerCase())} update <id> --email "new@example.com"`,
    ],
    handler: `async (id, options) => {
  const { format, ...data } = options
  const response = await client.${pluralize(resource.name.toLowerCase())}.update(id, data)
  formatOutput(response, format)
}`,
  }
}

/**
 * Generate delete command
 */
function generateDeleteCommand<T extends StorableData>(resource: ResourceDefinition<T>): CLICommand {
  return {
    name: 'delete',
    description: `Delete a ${resource.name}`,
    arguments: [
      {
        name: 'id',
        description: `${resource.name} ID`,
        required: true,
        type: 'string',
      },
    ],
    options: [
      {
        name: 'force',
        description: 'Skip confirmation',
        type: 'boolean',
        required: false,
        default: false,
      },
    ],
    examples: [
      `dotdo ${pluralize(resource.name.toLowerCase())} delete <id>`,
      `dotdo ${pluralize(resource.name.toLowerCase())} delete <id> --force`,
    ],
    handler: `async (id, options) => {
  if (!options.force) {
    const confirm = await askConfirmation('Are you sure you want to delete this ${resource.name}?')
    if (!confirm) return
  }
  await client.${pluralize(resource.name.toLowerCase())}.delete(id)
  console.log('${resource.name} deleted successfully')
}`,
  }
}

/**
 * Generate action command
 */
function generateActionCommand<T extends StorableData>(
  resource: ResourceDefinition<T>,
  actionName: string,
  _actionDef: ActionDef
): CLICommand {
  return {
    name: actionName,
    description: `${actionName} a ${resource.name}`,
    arguments: [
      {
        name: 'id',
        description: `${resource.name} ID`,
        required: true,
        type: 'string',
      },
    ],
    options: [
      {
        name: 'format',
        description: 'Output format',
        type: 'enum',
        required: false,
        default: 'table',
        choices: ['json', 'table', 'yaml'],
      },
    ],
    examples: [
      `dotdo ${pluralize(resource.name.toLowerCase())} ${actionName} <id>`,
    ],
    handler: `async (id, options) => {
  const response = await client.${pluralize(resource.name.toLowerCase())}.${actionName}(id)
  formatOutput(response, options.format)
}`,
  }
}

/**
 * Generate relation command
 */
function generateRelationCommand<T extends StorableData>(
  resource: ResourceDefinition<T>,
  relationName: string,
  relationDef: RelationDef
): CLICommand {
  const parentIdName = `${resource.name.toLowerCase()}Id`
  const relatedResource = relationDef.resource

  return {
    name: relationName,
    description: `Manage ${relatedResource} ${relationName} for ${resource.name}`,
    arguments: [
      {
        name: parentIdName,
        description: `${resource.name} ID`,
        required: true,
        type: 'string',
      },
    ],
    options: [
      {
        name: 'format',
        description: 'Output format',
        type: 'enum',
        required: false,
        default: 'table',
        choices: ['json', 'table', 'yaml'],
      },
    ],
    examples: [
      `dotdo ${pluralize(resource.name.toLowerCase())} ${relationName} <${parentIdName}>`,
    ],
    handler: `async (${parentIdName}, options) => {
  const response = await client.${pluralize(resource.name.toLowerCase())}.${relationName}(${parentIdName})
  formatOutput(response, options.format)
}`,
  }
}

/**
 * Extract enum choices from resource schema
 */
function getEnumChoices<T extends StorableData>(resource: ResourceDefinition<T>, fieldName: string): string[] | undefined {
  // Extract from Zod schema if available
  // Use type assertion for Zod internal structure access
  const schema = resource.schema as { shape?: Record<string, { _def?: { values?: string[]; innerType?: { _def?: { values?: string[] } } } }> }
  if (schema && schema.shape && schema.shape[fieldName]) {
    const fieldSchema = schema.shape[fieldName]
    if (fieldSchema._def?.values) {
      return fieldSchema._def.values
    }
    // Handle optional enums
    if (fieldSchema._def?.innerType?._def?.values) {
      return fieldSchema._def.innerType._def.values
    }
  }
  return undefined
}

/**
 * Simple pluralization helper
 */
function pluralize(word: string): string {
  if (word.endsWith('y')) {
    return word.slice(0, -1) + 'ies'
  }
  if (word.endsWith('s')) {
    return word + 'es'
  }
  return word + 's'
}

/**
 * Generate TypeScript code from CLI structure
 */
function generateTypeScriptCode(
  structure: CLIStructure,
  config: { baseUrl: string; commandPrefix: string }
): string {
  const { baseUrl, commandPrefix } = config

  let code = `// Auto-generated CLI commands
// Generated from resource definitions

import { Command } from 'commander'

/**
 * API Client configuration
 */
const client = createAPIClient('${baseUrl}')

/**
 * Format output based on format option
 */
function formatOutput(data: unknown, format: string = 'table') {
  if (format === 'json') {
    console.log(JSON.stringify(data, null, 2))
  } else if (format === 'yaml') {
    console.log(toYAML(data))
  } else {
    console.table(Array.isArray(data) ? data : [data])
  }
}

/**
 * Ask for user confirmation via readline
 */
async function askConfirmation(message: string): Promise<boolean> {
  const readline = await import('readline')
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  return new Promise((resolve) => {
    rl.question(\`\${message} (y/N): \`, (answer) => {
      rl.close()
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes')
    })
  })
}

/**
 * Create the CLI program
 */
export function createCLI(): Command {
  const program = new Command()

  program
    .name('${commandPrefix}')
    .description('Auto-generated CLI from API resources')
    .version('1.0.0')

`

  // Generate commands for each resource
  for (const command of structure.commands) {
    code += generateCommandCode(command, 2)
  }

  code += `
  return program
}

// Main entry point
if (require.main === module) {
  createCLI().parse()
}
`

  return code
}

/**
 * Generate TypeScript code for a single command
 */
function generateCommandCode(command: CLICommand, indent: number = 0): string {
  const spaces = '  '.repeat(indent)
  let code = ''

  if (!command.subcommands) {
    // Leaf command - generate with action
    code += `${spaces}program\n`
    code += `${spaces}  .command('${command.name}')\n`
    code += `${spaces}  .description('${command.description}')\n`

    // Add arguments
    if (command.arguments) {
      for (const arg of command.arguments) {
        const argStr = arg.required ? `<${arg.name}>` : `[${arg.name}]`
        code += `${spaces}  .argument('${argStr}', '${arg.description}')\n`
      }
    }

    // Add options
    if (command.options) {
      for (const option of command.options) {
        const flag = `-${option.name[0]}, --${option.name} <${option.type}>`
        code += `${spaces}  .option('${flag}', '${option.description}'`
        if (option.default !== undefined) {
          code += `, ${JSON.stringify(option.default)}`
        }
        code += `)\n`
      }
    }

    // Add action handler
    if (command.handler) {
      code += `${spaces}  .action(${command.handler})\n`
    }

    code += '\n'
  } else {
    // Parent command with subcommands
    code += `${spaces}const ${command.name}Command = program\n`
    code += `${spaces}  .command('${command.name}')\n`
    code += `${spaces}  .description('${command.description}')\n\n`

    // Generate subcommands
    for (const subcommand of command.subcommands) {
      code += `${spaces}${command.name}Command\n`
      code += `${spaces}  .command('${subcommand.name}')\n`
      code += `${spaces}  .description('${subcommand.description}')\n`

      // Add arguments
      if (subcommand.arguments) {
        for (const arg of subcommand.arguments) {
          const argStr = arg.required ? `<${arg.name}>` : `[${arg.name}]`
          code += `${spaces}  .argument('${argStr}', '${arg.description}')\n`
        }
      }

      // Add options
      if (subcommand.options) {
        for (const option of subcommand.options) {
          const flag = `-${option.name[0]}, --${option.name}`
          const flagWithType = option.type === 'boolean' ? flag : `${flag} <${option.type}>`
          code += `${spaces}  .option('${flagWithType}', '${option.description}'`
          if (option.default !== undefined) {
            code += `, ${JSON.stringify(option.default)}`
          }
          code += `)\n`
        }
      }

      // Add action handler
      if (subcommand.handler) {
        code += `${spaces}  .action(${subcommand.handler})\n`
      }

      code += '\n'
    }
  }

  return code
}

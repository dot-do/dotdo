import { describe, it, expect } from 'vitest'
import { generateCLI, type CLIGeneratorOptions, type CLICommand, type CLIOption, type CLIStructure } from '../codegen/cli'
import type { ResourceDefinition } from '../resource'
import { z } from 'zod'

describe('CLI Generation', () => {
  // Example resource definition
  const customerResource: ResourceDefinition<any> = {
    name: 'Customer',
    schema: z.object({
      name: z.string(),
      email: z.string().email(),
      plan: z.enum(['free', 'pro', 'enterprise']).optional(),
      active: z.boolean().default(true),
    }),
    fields: {
      name: { type: 'string', required: true },
      email: { type: 'string', required: true },
      plan: { type: 'enum', required: false },
      active: { type: 'boolean', required: false },
    },
    relations: {
      orders: { type: 'hasMany', resource: 'Order' },
    },
    actions: {
      upgrade: { method: 'POST', handler: async () => ({}) },
      downgrade: { method: 'POST', handler: async () => ({}) },
    },
  }

  const orderResource: ResourceDefinition<any> = {
    name: 'Order',
    schema: z.object({
      total: z.number(),
      status: z.string(),
    }),
    fields: {
      total: { type: 'number', required: true },
      status: { type: 'string', required: true },
    },
  }

  describe('generateCLI', () => {
    it('should generate CLI commands from resource definitions', () => {
      const resources = [customerResource, orderResource]
      const cli = generateCLI(resources)

      expect(cli).toBeDefined()
      expect(cli.commands).toBeDefined()
      expect(cli.commands.length).toBeGreaterThan(0)
    })

    it('should generate commands for each resource', () => {
      const resources = [customerResource]
      const cli = generateCLI(resources)

      // Should have a command for 'customers'
      const customerCommand = cli.commands.find((cmd: CLICommand) => cmd.name === 'customers')
      expect(customerCommand).toBeDefined()
      expect(customerCommand?.description).toBe('Manage Customer resources')
    })

    it('should generate CRUD subcommands', () => {
      const resources = [customerResource]
      const cli = generateCLI(resources)

      const customerCommand = cli.commands.find((cmd: CLICommand) => cmd.name === 'customers')
      expect(customerCommand?.subcommands).toBeDefined()

      const subcommandNames = customerCommand?.subcommands?.map((s: CLICommand) => s.name) || []
      expect(subcommandNames).toContain('list')
      expect(subcommandNames).toContain('get')
      expect(subcommandNames).toContain('create')
      expect(subcommandNames).toContain('update')
      expect(subcommandNames).toContain('delete')
    })

    it('should generate action commands', () => {
      const resources = [customerResource]
      const cli = generateCLI(resources)

      const customerCommand = cli.commands.find((cmd: CLICommand) => cmd.name === 'customers')
      const subcommandNames = customerCommand?.subcommands?.map((s: CLICommand) => s.name) || []

      // Custom actions from resource definition
      expect(subcommandNames).toContain('upgrade')
      expect(subcommandNames).toContain('downgrade')
    })

    it('should generate relation commands', () => {
      const resources = [customerResource]
      const cli = generateCLI(resources)

      const customerCommand = cli.commands.find((cmd: CLICommand) => cmd.name === 'customers')
      const subcommandNames = customerCommand?.subcommands?.map((s: CLICommand) => s.name) || []

      // Should have a command for accessing related orders
      expect(subcommandNames).toContain('orders')
    })
  })

  describe('Command Arguments', () => {
    it('should generate arguments from resource fields for create', () => {
      const resources = [customerResource]
      const cli = generateCLI(resources)

      const customerCommand = cli.commands.find((cmd: CLICommand) => cmd.name === 'customers')
      const createCommand = customerCommand?.subcommands?.find((s: CLICommand) => s.name === 'create')

      expect(createCommand?.options).toBeDefined()
      const optionNames = createCommand?.options?.map((o: CLIOption) => o.name) || []

      expect(optionNames).toContain('name')
      expect(optionNames).toContain('email')
      expect(optionNames).toContain('plan')
      expect(optionNames).toContain('active')
    })

    it('should mark required fields as required', () => {
      const resources = [customerResource]
      const cli = generateCLI(resources)

      const customerCommand = cli.commands.find((cmd: CLICommand) => cmd.name === 'customers')
      const createCommand = customerCommand?.subcommands?.find((s: CLICommand) => s.name === 'create')

      const nameOption = createCommand?.options?.find((o: CLIOption) => o.name === 'name')
      const planOption = createCommand?.options?.find((o: CLIOption) => o.name === 'plan')

      expect(nameOption?.required).toBe(true)
      expect(planOption?.required).toBe(false)
    })

    it('should include field types in option definitions', () => {
      const resources = [customerResource]
      const cli = generateCLI(resources)

      const customerCommand = cli.commands.find((cmd: CLICommand) => cmd.name === 'customers')
      const createCommand = customerCommand?.subcommands?.find((s: CLICommand) => s.name === 'create')

      const nameOption = createCommand?.options?.find((o: CLIOption) => o.name === 'name')
      const activeOption = createCommand?.options?.find((o: CLIOption) => o.name === 'active')

      expect(nameOption?.type).toBe('string')
      expect(activeOption?.type).toBe('boolean')
    })

    it('should support enum types with choices', () => {
      const resources = [customerResource]
      const cli = generateCLI(resources)

      const customerCommand = cli.commands.find((cmd: CLICommand) => cmd.name === 'customers')
      const createCommand = customerCommand?.subcommands?.find((s: CLICommand) => s.name === 'create')

      const planOption = createCommand?.options?.find((o: CLIOption) => o.name === 'plan')

      expect(planOption?.type).toBe('enum')
      expect(planOption?.choices).toEqual(['free', 'pro', 'enterprise'])
    })
  })

  describe('Help Text Generation', () => {
    it('should generate help text for commands', () => {
      const resources = [customerResource]
      const cli = generateCLI(resources)

      const customerCommand = cli.commands.find((cmd: CLICommand) => cmd.name === 'customers')
      const listCommand = customerCommand?.subcommands?.find((s: CLICommand) => s.name === 'list')

      expect(listCommand?.description).toBeDefined()
      expect(listCommand?.description).toBe('List all Customer resources')
    })

    it('should generate help text for arguments', () => {
      const resources = [customerResource]
      const cli = generateCLI(resources)

      const customerCommand = cli.commands.find((cmd: CLICommand) => cmd.name === 'customers')
      const createCommand = customerCommand?.subcommands?.find((s: CLICommand) => s.name === 'create')

      const nameOption = createCommand?.options?.find((o: CLIOption) => o.name === 'name')
      expect(nameOption?.description).toBeDefined()
    })

    it('should generate usage examples', () => {
      const resources = [customerResource]
      const cli = generateCLI(resources)

      const customerCommand = cli.commands.find((cmd: CLICommand) => cmd.name === 'customers')
      const createCommand = customerCommand?.subcommands?.find((s: CLICommand) => s.name === 'create')

      expect(createCommand?.examples).toBeDefined()
      expect(createCommand?.examples?.length).toBeGreaterThan(0)
    })
  })

  describe('Output Formatting', () => {
    it('should support JSON output format', () => {
      const resources = [customerResource]
      const cli = generateCLI(resources)

      const customerCommand = cli.commands.find((cmd: CLICommand) => cmd.name === 'customers')
      const listCommand = customerCommand?.subcommands?.find((s: CLICommand) => s.name === 'list')

      const formatOption = listCommand?.options?.find((o: CLIOption) => o.name === 'format')
      expect(formatOption).toBeDefined()
      expect(formatOption?.choices).toContain('json')
    })

    it('should support table output format', () => {
      const resources = [customerResource]
      const cli = generateCLI(resources)

      const customerCommand = cli.commands.find((cmd: CLICommand) => cmd.name === 'customers')
      const listCommand = customerCommand?.subcommands?.find((s: CLICommand) => s.name === 'list')

      const formatOption = listCommand?.options?.find((o: CLIOption) => o.name === 'format')
      expect(formatOption?.choices).toContain('table')
    })

    it('should support YAML output format', () => {
      const resources = [customerResource]
      const cli = generateCLI(resources)

      const customerCommand = cli.commands.find((cmd: CLICommand) => cmd.name === 'customers')
      const listCommand = customerCommand?.subcommands?.find((s: CLICommand) => s.name === 'list')

      const formatOption = listCommand?.options?.find((o: CLIOption) => o.name === 'format')
      expect(formatOption?.choices).toContain('yaml')
    })

    it('should default to table format', () => {
      const resources = [customerResource]
      const cli = generateCLI(resources)

      const customerCommand = cli.commands.find((cmd: CLICommand) => cmd.name === 'customers')
      const listCommand = customerCommand?.subcommands?.find((s: CLICommand) => s.name === 'list')

      const formatOption = listCommand?.options?.find((o: CLIOption) => o.name === 'format')
      expect(formatOption?.default).toBe('table')
    })
  })

  describe('Code Generation', () => {
    it('should generate TypeScript code for CLI commands', () => {
      const resources = [customerResource]
      const code = generateCLI(resources, { format: 'typescript' })

      expect(code).toBeDefined()
      expect(typeof code).toBe('string')
      expect(code).toContain("import { Command } from 'commander'")
      expect(code).toContain('customers')
    })

    it('should generate executable command structure', () => {
      const resources = [customerResource]
      const code = generateCLI(resources, { format: 'typescript' })

      expect(code).toContain('.command(')
      expect(code).toContain('.description(')
      expect(code).toContain('.action(')
    })

    it('should include API client integration', () => {
      const resources = [customerResource]
      const code = generateCLI(resources, { format: 'typescript' })

      // Should reference the SDK/API client
      expect(code).toContain('client')
      expect(code).toContain('customers')
    })
  })

  describe('CLI Generator Options', () => {
    it('should support custom output format', () => {
      const resources = [customerResource]
      const options: CLIGeneratorOptions = { format: 'typescript' }
      const code = generateCLI(resources, options)

      expect(typeof code).toBe('string')
    })

    it('should support JSON output for command structure', () => {
      const resources = [customerResource]
      const options: CLIGeneratorOptions = { format: 'json' }
      const result = generateCLI(resources, options)

      // When format is json, should return the structure as JSON string
      expect(typeof result).toBe('string')
      const parsed = JSON.parse(result as string)
      expect(parsed.commands).toBeDefined()
    })

    it('should support baseUrl option', () => {
      const resources = [customerResource]
      const options: CLIGeneratorOptions = {
        format: 'typescript',
        baseUrl: 'https://api.example.com',
      }
      const code = generateCLI(resources, options)

      expect(code).toContain('https://api.example.com')
    })

    it('should support custom command prefix', () => {
      const resources = [customerResource]
      const options: CLIGeneratorOptions = {
        format: 'typescript',
        commandPrefix: 'myapp',
      }
      const code = generateCLI(resources, options)

      expect(code).toContain('myapp')
    })
  })

  describe('ID Parameter Handling', () => {
    it('should require ID parameter for get command', () => {
      const resources = [customerResource]
      const cli = generateCLI(resources)

      const customerCommand = cli.commands.find((cmd: CLICommand) => cmd.name === 'customers')
      const getCommand = customerCommand?.subcommands?.find((s: CLICommand) => s.name === 'get')

      expect(getCommand?.arguments).toBeDefined()
      expect(getCommand?.arguments?.[0]?.name).toBe('id')
      expect(getCommand?.arguments?.[0]?.required).toBe(true)
    })

    it('should require ID parameter for update command', () => {
      const resources = [customerResource]
      const cli = generateCLI(resources)

      const customerCommand = cli.commands.find((cmd: CLICommand) => cmd.name === 'customers')
      const updateCommand = customerCommand?.subcommands?.find((s: CLICommand) => s.name === 'update')

      expect(updateCommand?.arguments).toBeDefined()
      expect(updateCommand?.arguments?.[0]?.name).toBe('id')
    })

    it('should require ID parameter for delete command', () => {
      const resources = [customerResource]
      const cli = generateCLI(resources)

      const customerCommand = cli.commands.find((cmd: CLICommand) => cmd.name === 'customers')
      const deleteCommand = customerCommand?.subcommands?.find((s: CLICommand) => s.name === 'delete')

      expect(deleteCommand?.arguments).toBeDefined()
      expect(deleteCommand?.arguments?.[0]?.name).toBe('id')
    })

    it('should require ID parameter for action commands', () => {
      const resources = [customerResource]
      const cli = generateCLI(resources)

      const customerCommand = cli.commands.find((cmd: CLICommand) => cmd.name === 'customers')
      const upgradeCommand = customerCommand?.subcommands?.find((s: CLICommand) => s.name === 'upgrade')

      expect(upgradeCommand?.arguments).toBeDefined()
      expect(upgradeCommand?.arguments?.[0]?.name).toBe('id')
    })
  })

  describe('Relation Command Structure', () => {
    it('should generate nested commands for relations', () => {
      const resources = [customerResource]
      const cli = generateCLI(resources)

      const customerCommand = cli.commands.find((cmd: CLICommand) => cmd.name === 'customers')
      const ordersCommand = customerCommand?.subcommands?.find((s: CLICommand) => s.name === 'orders')

      expect(ordersCommand).toBeDefined()
      expect(ordersCommand?.description).toContain('Order')
    })

    it('should include parent ID in relation commands', () => {
      const resources = [customerResource]
      const cli = generateCLI(resources)

      const customerCommand = cli.commands.find((cmd: CLICommand) => cmd.name === 'customers')
      const ordersCommand = customerCommand?.subcommands?.find((s: CLICommand) => s.name === 'orders')

      // Orders command should require customer ID
      expect(ordersCommand?.arguments).toBeDefined()
      expect(ordersCommand?.arguments?.[0]?.name).toBe('customerId')
    })
  })
})

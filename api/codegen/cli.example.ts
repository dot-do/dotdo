// Example: CLI command generation usage
// This demonstrates how to use the CLI generator with resource definitions

import { generateCLI } from './cli'
import { z } from 'zod'
import type { ResourceDefinition } from '../resource'

// Example 1: Simple resource
const Customer: ResourceDefinition<any> = {
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

// Example 2: Generate CLI structure (default)
const cliStructure = generateCLI([Customer])
console.log('CLI Structure:', JSON.stringify(cliStructure, null, 2))

// Example 3: Generate TypeScript code
const tsCode = generateCLI([Customer], { format: 'typescript' })
console.log('\nGenerated TypeScript:\n', tsCode)

// Example 4: Generate JSON output
const jsonOutput = generateCLI([Customer], { format: 'json' })
console.log('\nGenerated JSON:\n', jsonOutput)

// Example 5: Custom configuration
const customCLI = generateCLI([Customer], {
  format: 'typescript',
  baseUrl: 'https://api.myapp.com',
  commandPrefix: 'myapp',
})
console.log('\nCustom CLI:\n', customCLI)

/**
 * The generated CLI will support commands like:
 *
 * # List all customers
 * dotdo customers list
 * dotdo customers list --format json
 * dotdo customers list --limit 10
 *
 * # Get a specific customer
 * dotdo customers get cust_123
 * dotdo customers get cust_123 --format json
 *
 * # Create a customer
 * dotdo customers create --name "Alice" --email "alice@example.com"
 * dotdo customers create --name "Bob" --email "bob@example.com" --plan pro
 *
 * # Update a customer
 * dotdo customers update cust_123 --name "Alice Smith"
 * dotdo customers update cust_123 --plan enterprise
 *
 * # Delete a customer
 * dotdo customers delete cust_123
 * dotdo customers delete cust_123 --force
 *
 * # Custom actions
 * dotdo customers upgrade cust_123
 * dotdo customers downgrade cust_123
 *
 * # Relations
 * dotdo customers orders cust_123
 * dotdo customers orders cust_123 --format json
 */

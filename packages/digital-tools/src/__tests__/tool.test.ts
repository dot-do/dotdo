import { describe, it, expect } from 'vitest'
import type { Tool, Integration, Capability } from '../types'
import { createTool, createIntegration, createCapability } from '../types'

describe('Tool types', () => {
  it('Tool has required properties', () => {
    const tool: Tool = createTool({
      $id: 'https://schema.org.ai/tools/t1',
      name: 'Test Tool',
      description: 'A tool for testing'
    })
    expect(tool.$type).toBe('https://schema.org.ai/Tool')
    expect(tool.$id).toBe('https://schema.org.ai/tools/t1')
    expect(tool.name).toBe('Test Tool')
    expect(tool.description).toBe('A tool for testing')
  })

  it('Integration extends Tool for external services', () => {
    const integration: Integration = createIntegration({
      $id: 'https://schema.org.ai/integrations/stripe',
      name: 'Stripe',
      description: 'Payment processing',
      provider: 'stripe',
      authType: 'api_key',
      baseUrl: 'https://api.stripe.com'
    })
    expect(integration.$type).toBe('https://schema.org.ai/Integration')
    expect(integration.$id).toBe('https://schema.org.ai/integrations/stripe')
    expect(integration.provider).toBe('stripe')
    expect(integration.authType).toBe('api_key')
    expect(integration.baseUrl).toBe('https://api.stripe.com')
  })

  it('Capability extends Tool for internal capabilities', () => {
    const capability: Capability = createCapability({
      $id: 'https://schema.org.ai/capabilities/fsx',
      name: 'fsx',
      description: 'File system operations',
      permissions: ['read', 'write', 'delete']
    })
    expect(capability.$type).toBe('https://schema.org.ai/Capability')
    expect(capability.$id).toBe('https://schema.org.ai/capabilities/fsx')
    expect(capability.permissions).toEqual(['read', 'write', 'delete'])
  })

  it('Tool type discriminator works correctly', () => {
    const tool = createTool({
      $id: 'https://schema.org.ai/tools/t2',
      name: 'Another Tool',
      description: 'Another test'
    })

    // Type guard should work
    expect(tool.$type).toMatch(/^https:\/\/schema\.org\.ai\//)
  })

  it('Integration has all Tool properties plus integration-specific ones', () => {
    const integration = createIntegration({
      $id: 'https://schema.org.ai/integrations/github',
      name: 'GitHub',
      description: 'Code hosting and collaboration',
      provider: 'github',
      authType: 'oauth',
      baseUrl: 'https://api.github.com'
    })

    // Base Tool properties
    expect(integration.$id).toBeDefined()
    expect(integration.$type).toBeDefined()
    expect(integration.name).toBeDefined()
    expect(integration.description).toBeDefined()

    // Integration-specific properties
    expect(integration.provider).toBeDefined()
    expect(integration.authType).toBeDefined()
    expect(integration.baseUrl).toBeDefined()
  })

  it('Capability has all Tool properties plus capability-specific ones', () => {
    const capability = createCapability({
      $id: 'https://schema.org.ai/capabilities/bashx',
      name: 'bashx',
      description: 'Bash command execution',
      permissions: ['execute']
    })

    // Base Tool properties
    expect(capability.$id).toBeDefined()
    expect(capability.$type).toBeDefined()
    expect(capability.name).toBeDefined()
    expect(capability.description).toBeDefined()

    // Capability-specific properties
    expect(capability.permissions).toBeDefined()
  })
})

// Base Tool type
export interface Tool {
  $id: string
  $type: 'https://schema.org.ai/Tool'
  name: string
  description: string
}

// Integration - External service integration
export interface Integration extends Omit<Tool, '$type'> {
  $type: 'https://schema.org.ai/Integration'
  provider: string
  apiVersion: string
  authentication: 'api_key' | 'oauth' | 'bearer' | 'basic'
  baseUrl: string
}

// Capability - Internal capability
export interface Capability extends Omit<Tool, '$type'> {
  $type: 'https://schema.org.ai/Capability'
  permissions: string[]
  scope: 'workspace' | 'global' | 'user' | 'system'
}

// Factory functions
export function createTool(input: Omit<Tool, '$type'>): Tool {
  return { ...input, $type: 'https://schema.org.ai/Tool' }
}

export function createIntegration(input: Omit<Integration, '$type'>): Integration {
  return { ...input, $type: 'https://schema.org.ai/Integration' }
}

export function createCapability(input: Omit<Capability, '$type'>): Capability {
  return { ...input, $type: 'https://schema.org.ai/Capability' }
}

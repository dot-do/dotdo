/**
 * MCP Tool Generation - Generate Model Context Protocol tools from API resources
 *
 * This module generates MCP-compliant tool definitions from resource definitions,
 * enabling AI models to interact with the API through the MCP protocol.
 */

import type { ResourceDefinition, FieldDef, ActionDef } from '../resource'

/**
 * MCP Tool Definition
 */
export interface MCPTool {
  name: string
  description: string
  inputSchema: JSONSchema
  handler?: (params: unknown) => Promise<unknown>
}

/**
 * JSON Schema for tool input validation
 */
export interface JSONSchema {
  type: 'object'
  properties: Record<string, JSONSchemaProperty>
  required: string[]
}

export interface JSONSchemaProperty {
  type: string
  description: string
  format?: string
}

/**
 * MCP Server Configuration
 */
export interface MCPServerConfig {
  name: string
  version: string
  tools: MCPTool[]
}

/**
 * CRUD operations to generate for each resource
 */
const CRUD_OPERATIONS = ['create', 'get', 'update', 'delete', 'list'] as const
type CRUDOperation = typeof CRUD_OPERATIONS[number]

/**
 * MCPGenerator - Generate MCP tools from resource definitions
 */
export class MCPGenerator {
  /**
   * Generate all MCP tools from an array of resources
   */
  generateTools(resources: ResourceDefinition[]): MCPTool[] {
    const tools: MCPTool[] = []

    for (const resource of resources) {
      // Generate CRUD operations
      for (const operation of CRUD_OPERATIONS) {
        tools.push(this.generateCRUDTool(resource, operation))
      }

      // Generate custom action tools
      if (resource.actions) {
        for (const [actionName, actionDef] of Object.entries(resource.actions)) {
          tools.push(this.generateActionTool(resource, actionName, actionDef))
        }
      }
    }

    return tools
  }

  /**
   * Generate a CRUD operation tool
   */
  private generateCRUDTool(
    resource: ResourceDefinition,
    operation: CRUDOperation
  ): MCPTool {
    const resourceName = resource.name.toLowerCase()
    const toolName = `${resourceName}_${operation}`
    const description = this.generateDescription(resource.name, operation)
    const inputSchema = this.getInputSchemaForOperation(resource, operation)

    return {
      name: toolName,
      description,
      inputSchema,
      handler: this.createHandler(resource, operation)
    }
  }

  /**
   * Generate a custom action tool
   */
  private generateActionTool(
    resource: ResourceDefinition,
    actionName: string,
    actionDef: ActionDef
  ): MCPTool {
    const resourceName = resource.name.toLowerCase()
    const toolName = `${resourceName}_${actionName}`
    const description = `Perform ${actionName} action on ${resource.name.toLowerCase()}`

    // For custom actions, use the resource input schema
    const inputSchema = this.resourceToInputSchema(resource)

    return {
      name: toolName,
      description,
      inputSchema,
      handler: async (params: unknown) => {
        // Note: actionDef.handler expects Hono Context - this is a placeholder implementation
        // In production, this would create a synthetic context or use a different handler signature
        return await actionDef.handler(params as never)
      }
    }
  }

  /**
   * Get input schema based on operation type
   */
  private getInputSchemaForOperation(
    resource: ResourceDefinition,
    operation: CRUDOperation
  ): JSONSchema {
    switch (operation) {
      case 'create':
      case 'update':
        return this.resourceToInputSchema(resource)

      case 'get':
      case 'delete':
        // ID-only operations
        return {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: `The ${resource.name.toLowerCase()} ID`
            }
          },
          required: ['id']
        }

      case 'list':
        // List operations can have filters/pagination
        return {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Maximum number of items to return'
            },
            offset: {
              type: 'number',
              description: 'Number of items to skip'
            }
          },
          required: []
        }

      default:
        return this.resourceToInputSchema(resource)
    }
  }

  /**
   * Convert resource definition to JSON Schema input schema
   */
  resourceToInputSchema(resource: ResourceDefinition): JSONSchema {
    const properties: Record<string, JSONSchemaProperty> = {}
    const required: string[] = []

    for (const [fieldName, fieldDef] of Object.entries(resource.fields)) {
      properties[fieldName] = this.fieldToJSONSchema(fieldName, fieldDef)

      if (fieldDef.required !== false) {
        required.push(fieldName)
      }
    }

    return {
      type: 'object',
      properties,
      required
    }
  }

  /**
   * Convert a field definition to JSON Schema property
   */
  fieldToJSONSchema(fieldName: string, fieldDef: FieldDef): JSONSchemaProperty {
    const baseProperty: JSONSchemaProperty = {
      type: this.mapFieldTypeToJSONSchemaType(fieldDef.type),
      description: `The ${fieldName} field`
    }

    // Add format for specific types
    if (fieldDef.type === 'date') {
      baseProperty.format = 'date-time'
    }

    return baseProperty
  }

  /**
   * Map resource field type to JSON Schema type
   */
  private mapFieldTypeToJSONSchemaType(fieldType: string): string {
    const typeMap: Record<string, string> = {
      string: 'string',
      number: 'number',
      boolean: 'boolean',
      date: 'string', // Dates are strings in JSON Schema with format: date-time
      array: 'array',
      object: 'object'
    }

    return typeMap[fieldType] || 'string'
  }

  /**
   * Generate semantic description for LLM understanding
   */
  generateDescription(resourceName: string, operation: string): string {
    const resource = resourceName.toLowerCase()

    const descriptions: Record<string, string> = {
      create: `Create a new ${resource} in the system`,
      get: `Get a ${resource} by ID`,
      update: `Update an existing ${resource}`,
      delete: `Delete a ${resource} by ID`,
      list: `List all ${resource}s with optional filters`
    }

    return descriptions[operation] || `Perform ${operation} on ${resource}`
  }

  /**
   * Create a handler function for a CRUD operation
   * Note: These handlers are placeholders that would be connected to actual API calls
   */
  private createHandler(
    resource: ResourceDefinition,
    operation: CRUDOperation
  ): (params: unknown) => Promise<unknown> {
    return async (params: unknown) => {
      // Validate input against resource schema
      const result = resource.schema.safeParse(
        operation === 'create' || operation === 'update' ? params : {}
      )

      if (!result.success && (operation === 'create' || operation === 'update')) {
        throw new Error(`Invalid input: ${result.error.message}`)
      }

      // Placeholder response - in real implementation, this would call the API
      const paramsObj = params as Record<string, unknown>
      switch (operation) {
        case 'create':
          return { id: 'generated-id', ...paramsObj }
        case 'get':
          return { id: (paramsObj as { id: string }).id, ...paramsObj }
        case 'update':
          return { id: 'existing-id', ...paramsObj }
        case 'delete':
          return { success: true, id: (paramsObj as { id: string }).id }
        case 'list':
          return { items: [], total: 0 }
        default:
          return {}
      }
    }
  }

  /**
   * Generate complete MCP server configuration
   */
  generateServerConfig(
    resources: ResourceDefinition[],
    options: { name: string; version: string }
  ): MCPServerConfig {
    const tools = this.generateTools(resources)

    return {
      name: options.name,
      version: options.version,
      tools
    }
  }
}

/**
 * Generate MCP tools from resource definitions (convenience function)
 */
export function generateMCPTools(
  resources: ResourceDefinition[]
): MCPTool[] {
  const generator = new MCPGenerator()
  return generator.generateTools(resources)
}

/**
 * Export MCP server configuration (convenience function)
 */
export function generateMCPServerConfig(
  resources: ResourceDefinition[],
  options: { name: string; version: string }
): MCPServerConfig {
  const generator = new MCPGenerator()
  return generator.generateServerConfig(resources, options)
}

// SDK code generation from resource definitions
import type { ResourceDefinition } from '../resource'
import type { StorableData } from '@dotdo/db'

export interface SDKGeneratorOptions {
  output?: 'string' | 'file'
  filePath?: string
  includeJSDoc?: boolean
}

/**
 * SDK Generator class - generates TypeScript client SDK from resource definitions
 */
export class SDKGenerator<T extends StorableData = StorableData> {
  constructor(private resources: ResourceDefinition<T>[]) {}

  /**
   * Generate TypeScript interfaces from Zod schemas
   */
  generateTypes(): string {
    const types: string[] = []

    // Generate APIError class
    types.push(`
/**
 * API Error class for handling HTTP errors
 */
export class APIError extends Error {
  constructor(
    message: string,
    public status: number,
    public response?: any
  ) {
    super(message)
    this.name = 'APIError'
  }
}
`)

    // Generate interface for each resource
    for (const resource of this.resources) {
      const interfaceName = this.capitalize(this.singular(resource.name))

      types.push(`
/**
 * ${interfaceName} resource type
 */
export interface ${interfaceName} {`)

      // Generate fields from the resource definition
      for (const [fieldName, fieldDef] of Object.entries(resource.fields)) {
        const optional = fieldDef.required === false ? '?' : ''
        const tsType = this.mapFieldTypeToTS(fieldDef.type)
        types.push(`  ${fieldName}${optional}: ${tsType}`)
      }

      // Always include $id field
      if (!resource.fields.$id) {
        types.push(`  $id: string`)
      }

      types.push(`}\n`)
    }

    return types.join('\n')
  }

  /**
   * Generate the client factory function
   */
  generateClient(): string {
    return `
/**
 * Client configuration options
 */
export interface ClientOptions {
  baseUrl: string
  apiKey?: string
  headers?: Record<string, string>
}

/**
 * Create a new API client
 * @param options - Client configuration
 */
export function createClient(options: ClientOptions) {
  const { baseUrl, apiKey, headers = {} } = options

  /**
   * Internal request helper
   */
  async function request<T>(
    path: string,
    method: string = 'GET',
    body?: any
  ): Promise<T> {
    const url = \`\${baseUrl}\${path}\`

    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers
    }

    if (apiKey) {
      requestHeaders['Authorization'] = \`Bearer \${apiKey}\`
    }

    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: body ? JSON.stringify(body) : undefined
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }))
      throw new APIError(
        error.error || error.message || 'Request failed',
        response.status,
        error
      )
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return undefined as T
    }

    return response.json()
  }

  return {
${this.resources.map(r => `    ${r.name}: ${this.generateResourceProxy(r)}`).join(',\n')}
  }
}
`
  }

  /**
   * Generate methods for a specific resource
   * This includes CRUD methods at collection level, plus documentation/reference to instance methods
   */
  generateMethods(resource: ResourceDefinition<T>): string {
    const resourceName = resource.name
    const typeName = this.capitalize(this.singular(resourceName))
    const methods: string[] = []

    // CRUD methods
    methods.push(`
    /**
     * List all ${resourceName}
     * @example
     * const items = await client.${resourceName}.list()
     */
    list: async (): Promise<${typeName}[]> => {
      const response = await request<{ data: ${typeName}[] }>('/${resourceName}')
      return response.data || response as any
    }`)

    methods.push(`
    /**
     * Get a ${this.singular(resourceName)} by ID
     * @param id - Resource ID
     * @example
     * const item = await client.${resourceName}.get(id: string)
     */
    get: async (id: string): Promise<${typeName}> => {
      return request<${typeName}>(\`/${resourceName}/\${id}\`)
    }`)

    methods.push(`
    /**
     * Create a new ${this.singular(resourceName)}
     * @param data - Resource data
     * @example
     * const item = await client.${resourceName}.create(data: Omit<${typeName}, '$id'>)
     */
    create: async (data: Omit<${typeName}, '$id'>): Promise<${typeName}> => {
      return request<${typeName}>('/${resourceName}', 'POST', data)
    }`)

    methods.push(`
    /**
     * Update a ${this.singular(resourceName)}
     * @param id - Resource ID
     * @param data - Updated data
     * @example
     * const item = await client.${resourceName}.update(id: string, data: Partial<Omit<${typeName}, '$id'>>)
     */
    update: async (id: string, data: Partial<Omit<${typeName}, '$id'>>): Promise<${typeName}> => {
      return request<${typeName}>(\`/${resourceName}/\${id}\`, 'PUT', data)
    }`)

    methods.push(`
    /**
     * Delete a ${this.singular(resourceName)}
     * @param id - Resource ID
     * @example
     * await client.${resourceName}.delete(id: string)
     */
    delete: async (id: string): Promise<void> => {
      return request<void>(\`/${resourceName}/\${id}\`, 'DELETE')
    }`)

    // Add comment about relations (for documentation/testing purposes)
    if (resource.relations) {
      const relationNames = Object.keys(resource.relations)
      methods.push(`
    // Relations: ${relationNames.join(', ')}
    // Access via: ${resourceName}(id).${relationNames.join(', ')}`)
    }

    // Add comment about actions (for documentation/testing purposes)
    if (resource.actions) {
      const actionNames = Object.keys(resource.actions)
      methods.push(`
    // Actions: ${actionNames.join(', ')}
    // Access via: ${resourceName}(id).${actionNames.join(', ')}()`)
    }

    return methods.join(',\n')
  }

  /**
   * Generate a resource proxy function that supports both collection and instance methods
   */
  private generateResourceProxy(resource: ResourceDefinition<T>): string {
    const resourceName = resource.name
    const typeName = this.capitalize(this.singular(resourceName))

    // Generate instance methods (relations and actions)
    const instanceMethods: string[] = []

    // Add relation methods
    if (resource.relations) {
      for (const [relationName, relationDef] of Object.entries(resource.relations)) {
        const relationType = this.capitalize(this.singular(relationName))

        if (relationDef.type === 'hasMany') {
          instanceMethods.push(`
        ${relationName}: {
          /**
           * List ${relationName} for this ${this.singular(resourceName)}
           */
          list: async (): Promise<${relationType}[]> => {
            const response = await request<{ data: ${relationType}[] }>(\`/${resourceName}/\${id}/${relationName}\`)
            return response.data || response as any
          }
        }`)
        } else if (relationDef.type === 'belongsTo') {
          instanceMethods.push(`
        ${relationName}: {
          /**
           * Get ${relationName} for this ${this.singular(resourceName)}
           */
          get: async (): Promise<${relationType}> => {
            return request<${relationType}>(\`/${resourceName}/\${id}/${relationName}\`)
          }
        }`)
        } else if (relationDef.type === 'hasOne') {
          instanceMethods.push(`
        ${relationName}: {
          /**
           * Get ${relationName} for this ${this.singular(resourceName)}
           */
          get: async (): Promise<${relationType}> => {
            return request<${relationType}>(\`/${resourceName}/\${id}/${relationName}\`)
          }
        }`)
        }
      }
    }

    // Add action methods
    if (resource.actions) {
      for (const [actionName, actionDef] of Object.entries(resource.actions)) {
        instanceMethods.push(`
        /**
         * Execute ${actionName} action
         * @param params - Action parameters
         */
        ${actionName}: async (params?: any): Promise<any> => {
          return request(\`/${resourceName}/\${id}/${actionName}\`, '${actionDef.method}', params)
        }`)
      }
    }

    // Build the proxy function
    return `Object.assign(
      (id?: string) => {
        if (!id) {
          throw new Error('Resource ID is required')
        }
        return {
          /**
           * Get this ${this.singular(resourceName)} by ID
           */
          get: async (): Promise<${typeName}> => {
            return request<${typeName}>(\`/${resourceName}/\${id}\`)
          },
          /**
           * Update this ${this.singular(resourceName)}
           * @param data - Updated data
           */
          update: async (data: Partial<Omit<${typeName}, '$id'>>): Promise<${typeName}> => {
            return request<${typeName}>(\`/${resourceName}/\${id}\`, 'PUT', data)
          },
          /**
           * Delete this ${this.singular(resourceName)}
           */
          delete: async (): Promise<void> => {
            return request<void>(\`/${resourceName}/\${id}\`, 'DELETE')
          }${instanceMethods.length > 0 ? ',' : ''}
${instanceMethods.join(',\n')}
        }
      },
      {${this.generateMethods(resource)}}
    )`
  }

  /**
   * Generate complete SDK code
   */
  generate(): string {
    const parts: string[] = []

    // Header
    parts.push(`// Auto-generated TypeScript SDK
// Generated at: ${new Date().toISOString()}
// Do not edit manually
`)

    // Types
    parts.push(this.generateTypes())

    // Client
    parts.push(this.generateClient())

    return parts.join('\n')
  }

  /**
   * Helper: Capitalize first letter
   */
  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1)
  }

  /**
   * Helper: Convert plural to singular (simple implementation)
   */
  private singular(str: string): string {
    if (str.endsWith('ies')) {
      return str.slice(0, -3) + 'y'
    }
    if (str.endsWith('es')) {
      return str.slice(0, -2)
    }
    if (str.endsWith('s')) {
      return str.slice(0, -1)
    }
    return str
  }

  /**
   * Helper: Map field type to TypeScript type
   */
  private mapFieldTypeToTS(type: string): string {
    const typeMap: Record<string, string> = {
      string: 'string',
      number: 'number',
      boolean: 'boolean',
      date: 'Date',
      array: 'any[]',
      object: 'any'
    }
    return typeMap[type] || 'any'
  }
}

/**
 * Generate SDK code from resource definitions
 * @param resources - Array of resource definitions
 * @param options - Generation options
 */
export function generateSDK<T extends StorableData = StorableData>(
  resources: ResourceDefinition<T>[],
  options?: SDKGeneratorOptions
): string {
  const generator = new SDKGenerator<T>(resources)
  const code = generator.generate()

  if (options?.output === 'file' && options.filePath) {
    // File writing would be handled by the caller
    // This function just returns the string
  }

  return code
}

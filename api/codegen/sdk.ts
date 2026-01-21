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
    public response?: unknown
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
      if (!resource.fields['$id']) {
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
    body?: unknown
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
      return response.data || (response as unknown as ${typeName}[])
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
            return response.data || (response as unknown as ${relationType}[])
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
        ${actionName}: async (params?: Record<string, unknown>): Promise<unknown> => {
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
      array: 'unknown[]',
      object: 'Record<string, unknown>'
    }
    return typeMap[type] || 'unknown'
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

// ============================================================================
// SDK Generation from OpenAPI Spec
// ============================================================================

import type {
  OpenAPISpec,
  SchemaObject,
  OperationObject,
  ParameterObject
} from '../openapi'

/**
 * Options for SDK generation from OpenAPI spec
 */
export interface SDKFromOpenAPIOptions {
  /** Package name for the generated SDK */
  packageName?: string
  /** Whether to include timestamps in generated code */
  includeTimestamp?: boolean
  /** Target runtime environment */
  runtime?: 'node' | 'browser' | 'universal'
}

/**
 * SDK Generator from OpenAPI Spec - generates TypeScript client SDK from OpenAPI 3.0 specs
 */
export class SDKFromOpenAPIGenerator {
  constructor(private spec: OpenAPISpec) {}

  /**
   * Generate TypeScript interfaces from component schemas
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
    public response?: unknown
  ) {
    super(message)
    this.name = 'APIError'
  }
}
`)

    // Generate interfaces from component schemas
    const schemas = this.spec.components?.schemas || {}
    for (const [name, schema] of Object.entries(schemas)) {
      types.push(this.schemaToInterface(name, schema))
    }

    return types.join('\n')
  }

  /**
   * Convert an OpenAPI schema to a TypeScript interface
   */
  private schemaToInterface(name: string, schema: SchemaObject): string {
    const lines: string[] = []
    lines.push(`/**`)
    if (schema.description) {
      lines.push(` * ${schema.description}`)
    } else {
      lines.push(` * ${name} type`)
    }
    lines.push(` */`)
    lines.push(`export interface ${name} {`)

    const properties = schema.properties || {}
    const required = schema.required || []

    for (const [propName, propSchema] of Object.entries(properties)) {
      const isRequired = required.includes(propName)
      const optional = isRequired ? '' : '?'
      const tsType = this.schemaToType(propSchema)

      if (propSchema.description) {
        lines.push(`  /** ${propSchema.description} */`)
      }
      lines.push(`  ${propName}${optional}: ${tsType}`)
    }

    lines.push(`}`)
    return lines.join('\n')
  }

  /**
   * Convert an OpenAPI schema to TypeScript type string
   */
  private schemaToType(schema: SchemaObject): string {
    // Handle $ref
    if (schema.$ref) {
      const refName = schema.$ref.replace('#/components/schemas/', '')
      return refName
    }

    // Handle enum
    if (schema.enum) {
      return schema.enum.map(v => typeof v === 'string' ? `'${v}'` : String(v)).join(' | ')
    }

    // Handle arrays
    if (schema.type === 'array' && schema.items) {
      return `${this.schemaToType(schema.items)}[]`
    }

    // Handle objects with additionalProperties
    if (schema.type === 'object' && !schema.properties) {
      return 'Record<string, unknown>'
    }

    // Handle date-time format
    if (schema.type === 'string' && schema.format === 'date-time') {
      return 'string' // Use string for ISO dates, can be converted to Date by consumer
    }

    // Basic type mapping
    const typeMap: Record<string, string> = {
      string: 'string',
      number: 'number',
      integer: 'number',
      boolean: 'boolean',
      object: 'Record<string, unknown>',
      array: 'unknown[]'
    }

    return typeMap[schema.type || 'unknown'] || 'unknown'
  }

  /**
   * Generate operation methods for the client
   */
  generateMethods(): string {
    const methods: string[] = []
    const paths = this.spec.paths || {}

    for (const [path, pathItem] of Object.entries(paths)) {
      const operations = ['get', 'post', 'put', 'patch', 'delete'] as const

      for (const method of operations) {
        const operation = pathItem[method]
        if (!operation) continue

        methods.push(this.generateMethod(path, method.toUpperCase(), operation))
      }
    }

    return methods.join(',\n\n')
  }

  /**
   * Generate a single method from an operation
   */
  private generateMethod(path: string, method: string, operation: OperationObject): string {
    const operationId = operation.operationId || this.generateOperationId(path, method)
    const safeName = this.toSafeIdentifier(operationId)

    // Extract parameters
    const params = operation.parameters || []
    const pathParams = params.filter((p): p is ParameterObject => 'in' in p && p.in === 'path')
    const queryParams = params.filter((p): p is ParameterObject => 'in' in p && p.in === 'query')

    // Generate method signature
    const paramDefs: string[] = []
    for (const param of pathParams) {
      paramDefs.push(`${param.name}: string`)
    }

    // Add request body type for POST/PUT/PATCH
    let bodyType = 'unknown'
    if (operation.requestBody) {
      const content = operation.requestBody.content
      const jsonContent = content?.['application/json']
      if (jsonContent?.schema) {
        const schema = jsonContent.schema as SchemaObject
        if (schema.$ref) {
          bodyType = schema.$ref.replace('#/components/schemas/', '')
        }
      }
      paramDefs.push(`data: ${bodyType}`)
    }

    // Determine return type
    let returnType = 'void'
    const response = operation.responses?.['200'] || operation.responses?.['201']
    if (response?.content?.['application/json']?.schema) {
      const schema = response.content['application/json'].schema as SchemaObject
      if (schema.$ref) {
        returnType = schema.$ref.replace('#/components/schemas/', '')
      } else if (schema.type === 'array' && schema.items) {
        const itemSchema = schema.items as SchemaObject
        if (itemSchema.$ref) {
          returnType = `${itemSchema.$ref.replace('#/components/schemas/', '')}[]`
        }
      }
    }

    // Handle 204 No Content
    if (operation.responses?.['204'] && !operation.responses?.['200']) {
      returnType = 'void'
    }

    // Generate JSDoc
    const jsdoc = this.generateJSDoc(operation)

    // Build path with parameters
    let pathExpr = `'${path}'`
    if (pathParams.length > 0) {
      pathExpr = `\`${path.replace(/\{([^}]+)\}/g, '${$1}')}\``
    }

    // Build method body
    const methodBody = method === 'GET' || method === 'DELETE'
      ? `return request<${returnType}>(${pathExpr}, '${method}')`
      : `return request<${returnType}>(${pathExpr}, '${method}', data)`

    return `    ${jsdoc}
    ${safeName}: async (${paramDefs.join(', ')}): Promise<${returnType}> => {
      ${methodBody}
    }`
  }

  /**
   * Generate JSDoc from operation
   */
  private generateJSDoc(operation: OperationObject): string {
    const lines = ['/**']
    if (operation.summary) {
      lines.push(`     * ${operation.summary}`)
    }
    if (operation.description && operation.description !== operation.summary) {
      lines.push(`     * ${operation.description}`)
    }
    lines.push('     */')
    return lines.join('\n')
  }

  /**
   * Generate operation ID from path and method
   */
  private generateOperationId(path: string, method: string): string {
    const parts = path.split('/').filter(Boolean)
    const cleanParts = parts.map(p => p.replace(/[{}]/g, ''))
    return method.toLowerCase() + cleanParts.map(p => this.capitalize(p)).join('')
  }

  /**
   * Convert a string to a safe JavaScript identifier
   */
  private toSafeIdentifier(str: string): string {
    // Convert to camelCase and remove invalid characters
    return str
      .replace(/[-_\s]+(.)?/g, (_, c) => c ? c.toUpperCase() : '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .replace(/^[0-9]/, '_$&')
  }

  /**
   * Capitalize first letter
   */
  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1)
  }

  /**
   * Generate the client factory function
   */
  generateClient(): string {
    // Get security schemes
    const securitySchemes = this.spec.components?.securitySchemes || {}
    const hasBearerAuth = Object.values(securitySchemes).some(
      s => s.type === 'http' && s.scheme === 'bearer'
    )
    const hasApiKey = Object.values(securitySchemes).some(
      s => s.type === 'apiKey'
    )

    return `
/**
 * Client configuration options
 */
export interface ClientOptions {
  baseUrl: string
  ${hasBearerAuth ? 'bearerToken?: string' : ''}
  ${hasApiKey ? 'apiKey?: string' : ''}
  headers?: Record<string, string>
}

/**
 * Create a new API client
 * @param options - Client configuration
 */
export function createClient(options: ClientOptions) {
  const { baseUrl, ${hasBearerAuth ? 'bearerToken, ' : ''}${hasApiKey ? 'apiKey, ' : ''}headers = {} } = options

  /**
   * Internal request helper
   */
  async function request<T>(
    path: string,
    method: string = 'GET',
    body?: unknown
  ): Promise<T> {
    const url = \`\${baseUrl}\${path}\`

    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers
    }

    ${hasBearerAuth ? `if (bearerToken) {
      requestHeaders['Authorization'] = \`Bearer \${bearerToken}\`
    }` : ''}

    ${hasApiKey ? `if (apiKey) {
      requestHeaders['X-API-Key'] = apiKey
    }` : ''}

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
${this.generateMethods()}
  }
}
`
  }

  /**
   * Generate complete SDK code
   */
  generate(options?: SDKFromOpenAPIOptions): string {
    const parts: string[] = []

    // Header
    parts.push(`// Auto-generated TypeScript SDK from OpenAPI spec`)
    if (options?.includeTimestamp) {
      parts.push(`// Generated at: ${new Date().toISOString()}`)
    }
    parts.push(`// Do not edit manually`)
    parts.push('')

    // Types
    parts.push(this.generateTypes())

    // Client
    parts.push(this.generateClient())

    return parts.join('\n')
  }
}

/**
 * Generate SDK code from an OpenAPI specification
 * @param spec - OpenAPI 3.0 specification
 * @param options - Generation options
 */
export function generateSDKFromOpenAPI(
  spec: OpenAPISpec,
  options?: SDKFromOpenAPIOptions
): string {
  const generator = new SDKFromOpenAPIGenerator(spec)
  return generator.generate(options)
}

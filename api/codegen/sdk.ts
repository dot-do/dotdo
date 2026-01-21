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

// =============================================================================
// SDK Generation from OpenAPI Spec
// =============================================================================

import type {
  OpenAPISpec,
  OperationObject,
  ParameterObject,
  SchemaObject,
  ReferenceObject
} from '../openapi'

/**
 * Options for generating SDK from OpenAPI spec
 */
export interface SDKFromOpenAPIOptions {
  /** Package name for the generated SDK */
  packageName?: string
  /** Include generation timestamp in header */
  includeTimestamp?: boolean
  /** Target runtime (affects fetch implementation) */
  runtime?: 'browser' | 'node'
}

/**
 * SDK Generator class - generates TypeScript client SDK from OpenAPI spec
 */
export class SDKFromOpenAPIGenerator {
  private spec: OpenAPISpec
  private options: SDKFromOpenAPIOptions

  constructor(spec: OpenAPISpec, options: SDKFromOpenAPIOptions = {}) {
    this.spec = spec
    this.options = options
  }

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
    public response?: any
  ) {
    super(message)
    this.name = 'APIError'
  }
}
`)

    // Generate interfaces from component schemas
    const schemas = this.spec.components?.schemas || {}

    for (const [schemaName, schema] of Object.entries(schemas)) {
      types.push(this.schemaToInterface(schemaName, schema))
    }

    return types.join('\n')
  }

  /**
   * Convert an OpenAPI schema to a TypeScript interface
   */
  private schemaToInterface(name: string, schema: SchemaObject): string {
    const lines: string[] = []
    const requiredFields = schema.required || []

    lines.push(`
/**
 * ${name} type
 */
export interface ${name} {`)

    if (schema.properties) {
      for (const [fieldName, fieldSchema] of Object.entries(schema.properties)) {
        const isRequired = requiredFields.includes(fieldName)
        const optional = isRequired ? '' : '?'
        const tsType = this.schemaToTSType(fieldSchema)
        lines.push(`  ${fieldName}${optional}: ${tsType}`)
      }
    }

    lines.push(`}`)

    return lines.join('\n')
  }

  /**
   * Convert an OpenAPI schema to a TypeScript type string
   */
  private schemaToTSType(schema: SchemaObject | ReferenceObject): string {
    // Handle $ref
    if ('$ref' in schema && schema.$ref) {
      const refName = schema.$ref.split('/').pop()
      return refName || 'any'
    }

    const schemaObj = schema as SchemaObject

    // Handle enum
    if (schemaObj.enum) {
      return schemaObj.enum.map(v => `'${v}'`).join(' | ')
    }

    // Handle type
    switch (schemaObj.type) {
      case 'string':
        if (schemaObj.format === 'date-time') {
          return 'Date'
        }
        return 'string'
      case 'number':
      case 'integer':
        return 'number'
      case 'boolean':
        return 'boolean'
      case 'array':
        if (schemaObj.items) {
          return `${this.schemaToTSType(schemaObj.items)}[]`
        }
        return 'any[]'
      case 'object':
        if (schemaObj.properties) {
          const props = Object.entries(schemaObj.properties)
            .map(([k, v]) => `${k}: ${this.schemaToTSType(v)}`)
            .join('; ')
          return `{ ${props} }`
        }
        return 'Record<string, any>'
      default:
        return 'any'
    }
  }

  /**
   * Generate operation methods for the client
   */
  generateOperations(): string {
    const operations: string[] = []

    for (const [path, pathItem] of Object.entries(this.spec.paths)) {
      const methods: Array<'get' | 'post' | 'put' | 'patch' | 'delete'> =
        ['get', 'post', 'put', 'patch', 'delete']

      for (const method of methods) {
        const operation = pathItem[method]
        if (operation) {
          operations.push(this.generateOperation(path, method, operation))
        }
      }
    }

    return operations.join(',\n')
  }

  /**
   * Generate a single operation method
   */
  private generateOperation(
    path: string,
    method: string,
    operation: OperationObject
  ): string {
    const operationId = operation.operationId || this.generateOperationId(path, method)
    const methodName = this.toCamelCase(operationId)
    const summary = operation.summary || `${method.toUpperCase()} ${path}`

    // Extract parameters
    const pathParams: ParameterObject[] = []
    const queryParams: ParameterObject[] = []

    if (operation.parameters) {
      for (const param of operation.parameters) {
        if (param.in === 'path') {
          pathParams.push(param)
        } else if (param.in === 'query') {
          queryParams.push(param)
        }
      }
    }

    // Build parameter list
    const params: string[] = []

    // Add path parameters
    for (const param of pathParams) {
      params.push(`${param.name}: string`)
    }

    // Add request body parameter
    let requestBodyType = 'any'
    if (operation.requestBody) {
      const content = operation.requestBody.content?.['application/json']
      if (content?.schema) {
        requestBodyType = this.schemaToTSType(content.schema)
      }
      params.push(`data: ${requestBodyType}`)
    }

    // Add query parameters as optional object
    if (queryParams.length > 0) {
      const queryType = this.buildQueryParamsType(queryParams)
      params.push(`query?: ${queryType}`)
    }

    // Build return type
    const returnType = this.getReturnType(operation)

    // Build path template
    const pathTemplate = this.buildPathTemplate(path)

    // Build query string builder
    const queryBuilder = queryParams.length > 0
      ? `
    const queryString = query ? '?' + new URLSearchParams(
      Object.entries(query).filter(([_, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
    ).toString() : ''`
      : ''

    const queryAppend = queryParams.length > 0 ? ' + queryString' : ''

    // Generate the method
    return `
    /**
     * ${summary}
     */
    ${methodName}: async (${params.join(', ')}): Promise<${returnType}> => {${queryBuilder}
      return request<${returnType}>(\`${pathTemplate}\`${queryAppend}, '${method.toUpperCase()}'${operation.requestBody ? ', data' : ''})
    }`
  }

  /**
   * Build TypeScript type for query parameters
   */
  private buildQueryParamsType(params: ParameterObject[]): string {
    const fields = params.map(p => {
      const tsType = this.schemaToTSType(p.schema)
      const optional = p.required ? '' : '?'
      return `${p.name}${optional}: ${tsType}`
    })
    return `{ ${fields.join('; ')} }`
  }

  /**
   * Build path template string with variable interpolation
   */
  private buildPathTemplate(path: string): string {
    // Convert /customers/{id} to /customers/${id}
    return path.replace(/{([^}]+)}/g, '${$1}')
  }

  /**
   * Generate operation ID from path and method
   */
  private generateOperationId(path: string, method: string): string {
    // /customers -> listCustomers (GET) or createCustomers (POST)
    // /customers/{id} -> getCustomers (GET) or updateCustomers (PUT)

    const parts = path.split('/').filter(Boolean)
    const hasIdParam = parts.some(p => p.startsWith('{'))

    // Get the main resource name (first non-param segment)
    const resourceParts = parts.filter(p => !p.startsWith('{'))
    const resource: string = resourceParts.length > 0
      ? (resourceParts[resourceParts.length - 1] ?? 'item')
      : 'item'

    // Determine action based on method and whether there's an ID param
    let action: string
    if (hasIdParam) {
      switch (method) {
        case 'get': action = 'get'; break
        case 'put': action = 'update'; break
        case 'patch': action = 'patch'; break
        case 'delete': action = 'delete'; break
        default: action = method
      }
    } else {
      switch (method) {
        case 'get': action = 'list'; break
        case 'post': action = 'create'; break
        default: action = method
      }
    }

    // Build the operation name
    const resourceName = this.capitalize(resource)
    return `${action}${resourceName}`
  }

  /**
   * Get the return type from an operation's responses
   */
  private getReturnType(operation: OperationObject): string {
    // Check for 200, 201, or 204 responses
    const successCodes = ['200', '201', '204']

    for (const code of successCodes) {
      const response = operation.responses[code]
      if (response) {
        // 204 No Content returns void
        if (code === '204') {
          return 'void'
        }

        // Get schema from response content
        const content = response.content?.['application/json']
        if (content?.schema) {
          return this.schemaToTSType(content.schema)
        }
      }
    }

    return 'any'
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
  token?: string
  headers?: Record<string, string>
}

/**
 * Create a new API client
 * @param options - Client configuration
 */
export function createClient(options: ClientOptions) {
  const { baseUrl, apiKey, token, headers = {} } = options

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

    // Support Bearer token auth
    if (token) {
      requestHeaders['Authorization'] = \`Bearer \${token}\`
    }

    // Support API key auth (falls back if token not provided)
    if (apiKey && !token) {
      requestHeaders['Authorization'] = \`Bearer \${apiKey}\`
      requestHeaders['X-API-Key'] = apiKey
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

  return {${this.generateOperations()}
  }
}
`
  }

  /**
   * Generate complete SDK code
   */
  generate(): string {
    const parts: string[] = []

    // Header
    const packageName = this.options.packageName || this.spec.info.title || 'API Client'
    parts.push(`// Auto-generated TypeScript SDK for ${packageName}`)

    if (this.options.includeTimestamp) {
      parts.push(`// Generated at: ${new Date().toISOString()}`)
    }

    parts.push(`// Do not edit manually\n`)

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
   * Helper: Convert string to camelCase
   */
  private toCamelCase(str: string): string {
    // Handle kebab-case and snake_case
    return str
      .replace(/[-_]([a-z])/g, (_, letter) => letter.toUpperCase())
      .replace(/^[A-Z]/, letter => letter.toLowerCase())
  }
}

/**
 * Generate SDK code from OpenAPI specification
 * @param spec - OpenAPI 3.0 specification
 * @param options - Generation options
 */
export function generateSDKFromOpenAPI(
  spec: OpenAPISpec,
  options?: SDKFromOpenAPIOptions
): string {
  const generator = new SDKFromOpenAPIGenerator(spec, options)
  return generator.generate()
}

/**
 * Automation Actions - n8n-compatible action nodes
 *
 * Implements action nodes for workflow automation:
 * - HttpRequestAction: Make HTTP calls
 * - CodeAction: Execute JavaScript/TypeScript code
 * - SetAction: Set and transform data
 * - FunctionAction: Execute custom functions
 */

// ============================================================================
// TYPES
// ============================================================================

export interface ActionResult {
  success: boolean
  data?: unknown
  statusCode?: number
  error?: string
  filtered?: boolean
  headers?: Record<string, string>
}

export interface ActionContext {
  nodeId: string
  workflowId: string
  executionId: string
  [key: string]: unknown
}

export interface ActionHelpers {
  parseJson: (str: string) => unknown
  base64Encode: (str: string) => string
  base64Decode: (str: string) => string
  hash: (data: string, algorithm: 'sha256' | 'sha1' | 'md5') => string
}

// ============================================================================
// HTTP REQUEST ACTION
// ============================================================================

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

export interface HttpAuthentication {
  type: 'bearer' | 'basic' | 'apiKey'
  token?: string
  username?: string
  password?: string
  apiKey?: string
  headerName?: string
}

export interface HttpRetryConfig {
  maxRetries: number
  backoffMs: number
  retryOn?: number[]
}

export interface HttpRequestConfig {
  method: HttpMethod
  url: string
  headers?: Record<string, string>
  body?: unknown
  queryParameters?: Record<string, string>
  authentication?: HttpAuthentication
  timeout?: number
  retry?: HttpRetryConfig
  responseFormat?: 'json' | 'text' | 'binary'
  responseDataPath?: string
}

export class HttpRequestAction {
  readonly method: HttpMethod
  readonly url: string
  private config: HttpRequestConfig

  constructor(config: HttpRequestConfig) {
    this.method = config.method
    this.url = config.url
    this.config = config
  }

  async execute(input: Record<string, unknown>): Promise<ActionResult> {
    try {
      // Resolve URL with template variables
      let url = this.resolveTemplate(this.config.url, input)

      // Add query parameters
      if (this.config.queryParameters) {
        const params = new URLSearchParams()
        for (const [key, value] of Object.entries(this.config.queryParameters)) {
          params.append(key, this.resolveTemplate(value, input))
        }
        url += `?${params.toString()}`
      }

      // Build headers
      const headers: Record<string, string> = {
        ...this.config.headers,
      }

      // Add authentication
      if (this.config.authentication) {
        this.addAuthenticationHeaders(headers, this.config.authentication)
      }

      // Build body
      let body: string | undefined
      if (this.config.body && ['POST', 'PUT', 'PATCH'].includes(this.method)) {
        if (typeof this.config.body === 'string') {
          body = this.config.body
        } else {
          body = JSON.stringify(this.config.body)
          if (!headers['Content-Type']) {
            headers['Content-Type'] = 'application/json'
          }
        }
      }

      // Execute with retry logic
      const result = await this.executeWithRetry(url, headers, body)
      return result
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private async executeWithRetry(
    url: string,
    headers: Record<string, string>,
    body?: string
  ): Promise<ActionResult> {
    const maxRetries = this.config.retry?.maxRetries ?? 0
    const backoffMs = this.config.retry?.backoffMs ?? 1000
    const retryOn = this.config.retry?.retryOn ?? [500, 502, 503, 504]

    let lastError: Error | undefined
    let lastStatusCode: number | undefined

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        await this.sleep(backoffMs * attempt)
      }

      try {
        const result = await this.makeRequest(url, headers, body)

        // Check if we should retry based on status code
        if (result.statusCode && retryOn.includes(result.statusCode) && attempt < maxRetries) {
          lastStatusCode = result.statusCode
          continue
        }

        return result
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        if (attempt === maxRetries) {
          throw lastError
        }
      }
    }

    return {
      success: false,
      statusCode: lastStatusCode,
      error: lastError?.message ?? 'Request failed after retries',
    }
  }

  private async makeRequest(
    url: string,
    headers: Record<string, string>,
    body?: string
  ): Promise<ActionResult> {
    const controller = new AbortController()
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    if (this.config.timeout) {
      timeoutId = setTimeout(() => controller.abort(), this.config.timeout)
    }

    try {
      const response = await fetch(url, {
        method: this.method,
        headers,
        body,
        signal: controller.signal,
      })

      // Parse response
      let data: unknown

      const contentType = response.headers.get('content-type') ?? ''

      switch (this.config.responseFormat) {
        case 'text':
          data = await response.text()
          break
        case 'binary':
          data = await response.arrayBuffer()
          break
        default:
          if (contentType.includes('application/json')) {
            data = await response.json()
          } else {
            data = await response.text()
          }
      }

      // Extract data from path if specified
      if (this.config.responseDataPath && typeof data === 'object' && data !== null) {
        data = this.getValueByPath(data, this.config.responseDataPath)
      }

      const responseHeaders: Record<string, string> = {}
      response.headers.forEach((value, key) => { responseHeaders[key] = value })

      return {
        success: response.ok,
        statusCode: response.status,
        data,
        headers: responseHeaders,
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          success: false,
          error: 'Request timeout',
        }
      }
      throw error
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }

  private addAuthenticationHeaders(
    headers: Record<string, string>,
    auth: HttpAuthentication
  ): void {
    switch (auth.type) {
      case 'bearer':
        headers['Authorization'] = `Bearer ${auth.token}`
        break
      case 'basic':
        const encoded = btoa(`${auth.username}:${auth.password}`)
        headers['Authorization'] = `Basic ${encoded}`
        break
      case 'apiKey':
        headers[auth.headerName ?? 'X-API-Key'] = auth.apiKey!
        break
    }
  }

  private resolveTemplate(template: string, data: Record<string, unknown>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      return String(data[key] ?? '')
    })
  }

  private getValueByPath(obj: unknown, path: string): unknown {
    const parts = path.split('.')
    let current: unknown = obj

    for (const part of parts) {
      if (current === null || current === undefined) return undefined
      current = (current as Record<string, unknown>)[part]
    }

    return current
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

// ============================================================================
// CODE ACTION
// ============================================================================

export interface CodeActionConfig {
  language: 'javascript' | 'typescript'
  code: string
  async?: boolean
  mode?: 'once' | 'all'
  timeout?: number
}

export class CodeAction {
  readonly language: string
  private config: CodeActionConfig

  constructor(config: CodeActionConfig) {
    this.language = config.language
    this.config = config
  }

  async execute(
    input: unknown,
    items?: unknown[]
  ): Promise<ActionResult> {
    try {
      // Build execution context with helpers
      const helpers = {
        $now: () => new Date(),
        $uuid: () => crypto.randomUUID(),
        $env: (key: string) => {
          // Return empty for security - no actual env access
          return undefined
        },
      }

      // Create sandboxed function
      const fn = this.createSandboxedFunction(this.config.code, helpers)

      // Set up timeout
      const timeoutMs = this.config.timeout ?? 30000
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Code execution timeout')), timeoutMs)
      })

      // Execute
      let result: unknown

      if (this.config.mode === 'all' && items) {
        result = await Promise.race([
          fn({ input, items, ...helpers }),
          timeoutPromise,
        ])
      } else {
        result = await Promise.race([
          fn({ input, ...helpers }),
          timeoutPromise,
        ])
      }

      return {
        success: true,
        data: result,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private createSandboxedFunction(
    code: string,
    helpers: Record<string, unknown>
  ): (context: Record<string, unknown>) => Promise<unknown> {
    // Create function with limited scope
    // Note: In a real implementation, this would use a proper sandbox
    const helperKeys = Object.keys(helpers)
    const helperValues = Object.values(helpers)

    const wrappedCode = `
      return (async function(input, items, ${helperKeys.join(', ')}) {
        ${code}
      })(context.input, context.items, ${helperKeys.map((k) => `context.${k}`).join(', ')})
    `

    return new Function('context', wrappedCode) as (
      context: Record<string, unknown>
    ) => Promise<unknown>
  }
}

// ============================================================================
// SET ACTION
// ============================================================================

export interface SetValue {
  name: string
  value: unknown
}

export interface SetActionConfig {
  values: SetValue[]
  mode?: 'merge' | 'replace'
  keepUndefined?: boolean
}

export class SetAction {
  readonly values: SetValue[]
  private config: SetActionConfig

  constructor(config: SetActionConfig) {
    this.values = config.values
    this.config = config
  }

  async execute(input: Record<string, unknown>): Promise<ActionResult> {
    try {
      let result: Record<string, unknown>

      if (this.config.mode === 'replace') {
        result = {}
      } else {
        result = { ...input }
      }

      for (const { name, value } of this.config.values) {
        const resolvedValue = this.resolveValue(value, input)

        // Skip undefined if keepUndefined is false
        if (resolvedValue === undefined && this.config.keepUndefined === false) {
          continue
        }

        this.setValueByPath(result, name, resolvedValue)
      }

      return {
        success: true,
        data: result,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private resolveValue(value: unknown, input: Record<string, unknown>): unknown {
    if (typeof value !== 'string') {
      return value
    }

    // Expression syntax: ={{...}}
    if (value.startsWith('={{') && value.endsWith('}}')) {
      const expression = value.slice(3, -2)
      return this.evaluateExpression(expression, input)
    }

    // Template syntax: {{...}}
    if (value.includes('{{')) {
      return value.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, path) => {
        const val = this.getValueByPath(input, path)
        return val !== undefined ? String(val) : ''
      })
    }

    return value
  }

  private evaluateExpression(
    expression: string,
    input: Record<string, unknown>
  ): unknown {
    // Simple expression evaluation
    // In production, use a proper expression parser
    try {
      const fn = new Function(
        ...Object.keys(input),
        `return ${expression}`
      )
      return fn(...Object.values(input))
    } catch {
      return undefined
    }
  }

  private getValueByPath(obj: unknown, path: string): unknown {
    const parts = path.split('.')
    let current: unknown = obj

    for (const part of parts) {
      if (current === null || current === undefined) return undefined
      current = (current as Record<string, unknown>)[part]
    }

    return current
  }

  private setValueByPath(
    obj: Record<string, unknown>,
    path: string,
    value: unknown
  ): void {
    // Handle array notation like items[0]
    const arrayMatch = path.match(/^(.+)\[(\d+)\]$/)
    if (arrayMatch) {
      const [, arrayPath, indexStr] = arrayMatch
      const index = parseInt(indexStr, 10)
      const arr = this.ensureArray(obj, arrayPath)
      arr[index] = value
      return
    }

    const parts = path.split('.')

    let current = obj
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]
      if (!(part in current) || typeof current[part] !== 'object') {
        current[part] = {}
      }
      current = current[part] as Record<string, unknown>
    }

    current[parts[parts.length - 1]] = value
  }

  private ensureArray(
    obj: Record<string, unknown>,
    path: string
  ): unknown[] {
    const parts = path.split('.')
    let current = obj

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]
      if (!(part in current) || typeof current[part] !== 'object') {
        current[part] = {}
      }
      current = current[part] as Record<string, unknown>
    }

    const lastPart = parts[parts.length - 1]
    if (!Array.isArray(current[lastPart])) {
      current[lastPart] = []
    }

    return current[lastPart] as unknown[]
  }
}

// ============================================================================
// FUNCTION ACTION
// ============================================================================

export interface FunctionActionConfig {
  name: string
  fn: (
    input: unknown,
    context?: ActionContext,
    helpers?: ActionHelpers
  ) => Promise<unknown>
}

export class FunctionAction {
  readonly name: string
  private config: FunctionActionConfig

  constructor(config: FunctionActionConfig) {
    this.name = config.name
    this.config = config
  }

  async execute(
    input: unknown,
    _items?: unknown[],
    context?: ActionContext
  ): Promise<ActionResult> {
    try {
      const helpers: ActionHelpers = {
        parseJson: (str: string) => JSON.parse(str),
        base64Encode: (str: string) => btoa(str),
        base64Decode: (str: string) => atob(str),
        hash: (data: string, algorithm: 'sha256' | 'sha1' | 'md5') => {
          // Simple hash implementation for demo
          // In production, use crypto.subtle
          let hash = 0
          for (let i = 0; i < data.length; i++) {
            const char = data.charCodeAt(i)
            hash = ((hash << 5) - hash) + char
            hash = hash & hash
          }
          return hash.toString(16)
        },
      }

      const result = await this.config.fn(input, context, helpers)

      // Handle null as filter signal
      if (result === null) {
        return {
          success: true,
          filtered: true,
          data: null,
        }
      }

      return {
        success: true,
        data: result,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

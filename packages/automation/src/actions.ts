/**
 * Automation Actions - n8n-compatible action nodes
 *
 * Implements action nodes for workflow automation:
 * - HttpRequestAction: Make HTTP calls to external APIs
 * - CodeAction: Execute JavaScript/TypeScript code
 * - SetAction: Data transformation and assignment
 * - FunctionAction: Custom logic via provided functions
 */

// ============================================================================
// TYPES
// ============================================================================

export interface ActionContext {
  nodeId?: string
  workflowId?: string
  executionId?: string
}

export interface ActionResult {
  success: boolean
  data?: unknown
  error?: string
  statusCode?: number
  filtered?: boolean
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
  key?: string
  value?: string
  header?: string
}

export interface RetryConfig {
  maxRetries: number
  backoffMs: number
  retryOn?: number[]
}

export interface HttpRequestActionConfig {
  method: HttpMethod
  url: string
  headers?: Record<string, string>
  body?: unknown
  queryParameters?: Record<string, string>
  authentication?: HttpAuthentication
  timeout?: number
  retry?: RetryConfig
  responseFormat?: 'json' | 'text' | 'binary'
  responseDataPath?: string
}

export class HttpRequestAction {
  readonly method: HttpMethod
  readonly url: string
  private config: HttpRequestActionConfig

  constructor(config: HttpRequestActionConfig) {
    this.method = config.method
    this.url = config.url
    this.config = config
  }

  async execute(input: Record<string, unknown>): Promise<ActionResult> {
    try {
      // Build URL with parameters
      let url = this.interpolateString(this.url, input)

      if (this.config.queryParameters) {
        const params = new URLSearchParams()
        for (const [key, value] of Object.entries(this.config.queryParameters)) {
          params.append(key, this.interpolateString(value, input))
        }
        url += `?${params.toString()}`
      }

      // Build headers
      const headers: Record<string, string> = {
        ...this.config.headers,
      }

      // Add authentication
      if (this.config.authentication) {
        this.addAuthentication(headers)
      }

      // Build request options
      const options: RequestInit = {
        method: this.method,
        headers,
      }

      if (this.config.body && ['POST', 'PUT', 'PATCH'].includes(this.method)) {
        if (typeof this.config.body === 'object') {
          options.body = JSON.stringify(this.config.body)
          if (!headers['Content-Type']) {
            headers['Content-Type'] = 'application/json'
          }
        } else {
          options.body = String(this.config.body)
        }
      }

      // Execute with retry logic
      const result = await this.executeWithRetry(url, options)
      return result
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private async executeWithRetry(url: string, options: RequestInit): Promise<ActionResult> {
    const maxRetries = this.config.retry?.maxRetries ?? 0
    const backoffMs = this.config.retry?.backoffMs ?? 1000
    const retryOn = this.config.retry?.retryOn ?? [500, 502, 503, 504]

    let lastError: Error | null = null
    let lastResult: ActionResult | null = null

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Add timeout using AbortController
        const controller = new AbortController()
        let timeoutId: ReturnType<typeof setTimeout> | null = null

        if (this.config.timeout) {
          timeoutId = setTimeout(() => controller.abort(), this.config.timeout)
        }

        try {
          const response = await fetch(url, {
            ...options,
            signal: controller.signal,
          })

          if (timeoutId) clearTimeout(timeoutId)

          const result = await this.processResponse(response)
          lastResult = result

          // Check if we should retry
          if (!result.success && result.statusCode && retryOn.includes(result.statusCode)) {
            if (attempt < maxRetries) {
              await this.sleep(backoffMs * (attempt + 1))
              continue
            }
          }

          return result
        } catch (error) {
          if (timeoutId) clearTimeout(timeoutId)

          if (error instanceof Error && error.name === 'AbortError') {
            return {
              success: false,
              error: 'Request timeout',
            }
          }
          throw error
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        if (attempt < maxRetries) {
          await this.sleep(backoffMs * (attempt + 1))
          continue
        }
      }
    }

    return (
      lastResult ?? {
        success: false,
        error: lastError?.message ?? 'Request failed',
      }
    )
  }

  private async processResponse(response: Response): Promise<ActionResult> {
    const statusCode = response.status
    const success = statusCode >= 200 && statusCode < 300

    let data: unknown

    const contentType = response.headers.get('content-type') ?? ''

    if (this.config.responseFormat === 'text') {
      data = await response.text()
    } else if (contentType.includes('application/json')) {
      try {
        data = await response.json()
      } catch {
        data = await response.text()
      }
    } else {
      // Try to parse as JSON first (common for APIs that don't set content-type correctly)
      const text = await response.text()
      try {
        data = JSON.parse(text)
      } catch {
        data = text
      }
    }

    // Extract specific path if configured
    if (success && this.config.responseDataPath && typeof data === 'object' && data !== null) {
      data = this.getNestedValue(data as Record<string, unknown>, this.config.responseDataPath)
    }

    return {
      success,
      data,
      statusCode,
    }
  }

  private addAuthentication(headers: Record<string, string>): void {
    const auth = this.config.authentication
    if (!auth) return

    switch (auth.type) {
      case 'bearer':
        headers['Authorization'] = `Bearer ${auth.token}`
        break
      case 'basic': {
        const credentials = btoa(`${auth.username}:${auth.password}`)
        headers['Authorization'] = `Basic ${credentials}`
        break
      }
      case 'apiKey':
        if (auth.header) {
          headers[auth.header] = auth.value ?? ''
        }
        break
    }
  }

  private interpolateString(str: string, data: Record<string, unknown>): string {
    return str.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      return String(data[key] ?? '')
    })
  }

  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.')
    let current: unknown = obj

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined
      }
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
  mode?: 'each' | 'all'
  async?: boolean
  timeout?: number
}

export class CodeAction {
  readonly language: string
  private config: CodeActionConfig

  constructor(config: CodeActionConfig) {
    this.language = config.language
    this.config = config
  }

  async execute(input: Record<string, unknown>, items?: unknown[]): Promise<ActionResult> {
    try {
      const code = this.config.code

      // Create helper functions
      const helpers = {
        $now: () => new Date(),
        $uuid: () => crypto.randomUUID(),
        $env: (key: string) => (typeof process !== 'undefined' ? process.env[key] : undefined),
      }

      // Build the function
      let fn: Function

      if (this.config.mode === 'all') {
        fn = new Function(
          'input',
          'items',
          '$now',
          '$uuid',
          '$env',
          `
          ${code}
        `
        )
      } else {
        fn = new Function(
          'input',
          '$now',
          '$uuid',
          '$env',
          `
          ${code}
        `
        )
      }

      // Execute with timeout if configured
      let result: unknown

      if (this.config.mode === 'all' && items) {
        result = fn(input, items, helpers.$now, helpers.$uuid, helpers.$env)
      } else {
        result = fn(input, helpers.$now, helpers.$uuid, helpers.$env)
      }

      // Handle async results
      if (result instanceof Promise) {
        result = await result
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
      const result: Record<string, unknown> =
        this.config.mode === 'merge' ? { ...input } : {}

      for (const { name, value } of this.values) {
        const resolvedValue = this.resolveValue(value, input)

        if (resolvedValue === undefined && !this.config.keepUndefined) {
          continue
        }

        this.setNestedValue(result, name, resolvedValue)
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

    // Check for expression syntax ={{...}}
    if (value.startsWith('={{') && value.endsWith('}}')) {
      const expression = value.slice(3, -2)
      try {
        // Create a function that has access to all input properties directly
        const keys = Object.keys(input)
        const values = Object.values(input)
        const fn = new Function(...keys, `return ${expression}`)
        return fn(...values)
      } catch {
        return undefined
      }
    }

    // Check for template syntax {{...}}
    if (value.includes('{{') && value.includes('}}')) {
      return value.replace(/\{\{(\w+)\}\}/g, (_, key) => {
        const val = input[key]
        return val !== undefined ? String(val) : ''
      })
    }

    return value
  }

  private setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
    // Handle array notation
    const parts = path.split(/\.|\[/)

    let current: Record<string, unknown> = obj

    for (let i = 0; i < parts.length - 1; i++) {
      let part = parts[i]
      if (part.endsWith(']')) {
        part = part.slice(0, -1)
      }

      if (!(part in current)) {
        // Check if next part is a number (array index)
        const nextPart = parts[i + 1]
        if (nextPart && /^\d+\]?$/.test(nextPart)) {
          current[part] = []
        } else {
          current[part] = {}
        }
      }

      current = current[part] as Record<string, unknown>
    }

    let lastPart = parts[parts.length - 1]
    if (lastPart.endsWith(']')) {
      lastPart = lastPart.slice(0, -1)
    }

    current[lastPart] = value
  }
}

// ============================================================================
// FUNCTION ACTION
// ============================================================================

export interface FunctionHelpers {
  parseJson: (str: string) => unknown
  base64Encode: (str: string) => string
  base64Decode: (str: string) => string
  hash: (data: string, algorithm: string) => string
}

export interface FunctionActionConfig {
  name: string
  fn: (input: unknown, context?: ActionContext, helpers?: FunctionHelpers) => Promise<unknown>
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
      const helpers: FunctionHelpers = {
        parseJson: (str: string) => JSON.parse(str),
        base64Encode: (str: string) => btoa(str),
        base64Decode: (str: string) => atob(str),
        hash: (data: string, _algorithm: string) => {
          // Simple hash for demo - in production would use crypto
          let hash = 0
          for (let i = 0; i < data.length; i++) {
            const char = data.charCodeAt(i)
            hash = (hash << 5) - hash + char
            hash = hash & hash
          }
          return hash.toString(16)
        },
      }

      const result = await this.config.fn(input, context, helpers)

      // Check if result is null (filter)
      if (result === null) {
        return {
          success: true,
          data: null,
          filtered: true,
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

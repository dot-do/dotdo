/**
 * @dotdo/auth0 - Rules Engine
 *
 * Auth0 Rules execution engine for legacy Rules support.
 * Rules are JavaScript functions that execute during authentication flows.
 *
 * @example Basic Usage
 * ```typescript
 * import { RulesEngine } from '@dotdo/auth0'
 *
 * const engine = new RulesEngine()
 *
 * // Create a rule
 * const rule = engine.create({
 *   name: 'Add custom claim',
 *   script: `
 *     function addCustomClaim(user, context, callback) {
 *       context.accessToken['https://example.com/roles'] = user.app_metadata.roles;
 *       callback(null, user, context);
 *     }
 *   `,
 * })
 *
 * // Execute rules during login
 * const result = await engine.execute(user, context)
 * ```
 *
 * @see https://auth0.com/docs/customize/rules
 * @module
 */

import type {
  Rule,
  CreateRuleParams,
  UpdateRuleParams,
  RuleContext,
  RuleExecutionResult,
  User,
} from './types'
import { Auth0ManagementError } from './types'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Options for RulesEngine
 */
export interface RulesEngineOptions {
  /** Execution timeout in milliseconds (default: 20000) */
  timeout?: number
  /** Global configuration available to rules */
  configuration?: Record<string, string>
}

/**
 * Pipeline execution result
 */
export interface RulesPipelineResult {
  /** Whether all rules executed successfully */
  success: boolean
  /** Modified user object */
  user: User
  /** Modified context object */
  context: RuleContext
  /** Individual rule results */
  results: RuleExecutionResult[]
  /** Total execution time in ms */
  totalExecutionTimeMs: number
  /** Error if pipeline failed */
  error?: string
}

// ============================================================================
// RULES ENGINE
// ============================================================================

/**
 * Auth0 Rules Engine
 *
 * Executes Auth0 Rules (legacy) during authentication flows.
 * Rules are executed in order based on their `order` property.
 */
export class RulesEngine {
  private rules = new Map<string, Rule>()
  private timeout: number
  private configuration: Record<string, string>

  constructor(options: RulesEngineOptions = {}) {
    this.timeout = options.timeout ?? 20000
    this.configuration = options.configuration ?? {}
  }

  // ============================================================================
  // CRUD OPERATIONS
  // ============================================================================

  /**
   * Create a new rule
   */
  create(params: CreateRuleParams): Rule {
    if (!params.name) {
      throw new Auth0ManagementError('Rule name is required', 400, 'invalid_body')
    }
    if (!params.script) {
      throw new Auth0ManagementError('Rule script is required', 400, 'invalid_body')
    }

    // Check for duplicate name
    for (const rule of this.rules.values()) {
      if (rule.name === params.name) {
        throw new Auth0ManagementError(
          'A rule with this name already exists',
          409,
          'rule_conflict'
        )
      }
    }

    const now = new Date().toISOString()
    const id = this.generateId()

    const rule: Rule = {
      id,
      name: params.name,
      script: params.script,
      order: params.order ?? this.getNextOrder(),
      enabled: params.enabled ?? true,
      stage: params.stage ?? 'login_success',
      created_at: now,
      updated_at: now,
    }

    this.rules.set(id, rule)
    return rule
  }

  /**
   * Get a rule by ID
   */
  get(id: string): Rule | null {
    return this.rules.get(id) ?? null
  }

  /**
   * Get all rules
   */
  getAll(params?: { enabled?: boolean; stage?: string }): Rule[] {
    let rules = Array.from(this.rules.values())

    if (params?.enabled !== undefined) {
      rules = rules.filter((r) => r.enabled === params.enabled)
    }

    if (params?.stage) {
      rules = rules.filter((r) => r.stage === params.stage)
    }

    // Sort by order
    return rules.sort((a, b) => a.order - b.order)
  }

  /**
   * Update a rule
   */
  update(id: string, params: UpdateRuleParams): Rule {
    const rule = this.rules.get(id)
    if (!rule) {
      throw new Auth0ManagementError('Rule not found', 404, 'inexistent_rule')
    }

    // Check for duplicate name if name is being changed
    if (params.name && params.name !== rule.name) {
      for (const r of this.rules.values()) {
        if (r.name === params.name && r.id !== id) {
          throw new Auth0ManagementError(
            'A rule with this name already exists',
            409,
            'rule_conflict'
          )
        }
      }
    }

    const updatedRule: Rule = {
      ...rule,
      name: params.name ?? rule.name,
      script: params.script ?? rule.script,
      order: params.order ?? rule.order,
      enabled: params.enabled ?? rule.enabled,
      stage: params.stage ?? rule.stage,
      updated_at: new Date().toISOString(),
    }

    this.rules.set(id, updatedRule)
    return updatedRule
  }

  /**
   * Delete a rule
   */
  delete(id: string): void {
    this.rules.delete(id)
  }

  /**
   * Enable a rule
   */
  enable(id: string): Rule {
    return this.update(id, { enabled: true })
  }

  /**
   * Disable a rule
   */
  disable(id: string): Rule {
    return this.update(id, { enabled: false })
  }

  // ============================================================================
  // EXECUTION
  // ============================================================================

  /**
   * Execute all enabled rules for a given stage
   */
  async execute(
    user: User,
    context: RuleContext,
    stage: 'login_success' | 'login_failure' | 'pre_authorize' = 'login_success'
  ): Promise<RulesPipelineResult> {
    const startTime = Date.now()
    const results: RuleExecutionResult[] = []

    // Get enabled rules for this stage, sorted by order
    const rules = this.getAll({ enabled: true, stage })

    let currentUser = { ...user }
    let currentContext = { ...context }
    let pipelineError: string | undefined

    for (const rule of rules) {
      const result = await this.executeRule(rule, currentUser, currentContext)
      results.push(result)

      if (!result.success) {
        pipelineError = result.error
        break
      }

      // Update user and context for next rule
      if (result.user) {
        currentUser = result.user
      }
      if (result.context) {
        currentContext = result.context
      }
    }

    return {
      success: !pipelineError,
      user: currentUser,
      context: currentContext,
      results,
      totalExecutionTimeMs: Date.now() - startTime,
      error: pipelineError,
    }
  }

  /**
   * Execute a single rule
   */
  async executeRule(
    rule: Rule,
    user: User,
    context: RuleContext
  ): Promise<RuleExecutionResult> {
    const startTime = Date.now()

    try {
      // Create sandboxed execution environment
      const result = await this.runInSandbox(rule.script, user, context)

      return {
        success: true,
        user: result.user,
        context: result.context,
        executionTimeMs: Date.now() - startTime,
        ruleId: rule.id,
        ruleName: rule.name,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTimeMs: Date.now() - startTime,
        ruleId: rule.id,
        ruleName: rule.name,
      }
    }
  }

  /**
   * Execute a rule script in a sandboxed environment
   */
  private async runInSandbox(
    script: string,
    user: User,
    context: RuleContext
  ): Promise<{ user: User; context: RuleContext }> {
    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeoutId = setTimeout(() => {
        reject(new Error('Rule execution timeout'))
      }, this.timeout)

      try {
        // Create the callback function
        const callback = (error: Error | null, resultUser?: User, resultContext?: RuleContext) => {
          clearTimeout(timeoutId)
          if (error) {
            reject(error)
          } else {
            resolve({
              user: resultUser ?? user,
              context: resultContext ?? context,
            })
          }
        }

        // Create a sandboxed global object for rules
        const sandbox = this.createSandbox()

        // Extract function name from script
        const functionName = this.extractFunctionName(script)
        if (!functionName) {
          throw new Error('Invalid rule script: no function found')
        }

        // Create the rule function
        const wrappedScript = `
          ${script}
          return ${functionName};
        `

        // Create function with sandbox
        const createFunction = new Function(
          'configuration',
          'console',
          'require',
          'global',
          wrappedScript
        )

        const ruleFn = createFunction(
          this.configuration,
          sandbox.console,
          sandbox.require,
          sandbox.global
        )

        // Execute the rule
        ruleFn(user, context, callback)
      } catch (error) {
        clearTimeout(timeoutId)
        reject(error)
      }
    })
  }

  /**
   * Create a sandboxed environment for rule execution
   */
  private createSandbox(): {
    console: typeof console
    require: (module: string) => unknown
    global: Record<string, unknown>
  } {
    // Sandboxed console that captures logs
    const sandboxConsole = {
      log: (...args: unknown[]) => {
        // In production, would capture logs for debugging
        console.log('[Rule]', ...args)
      },
      error: (...args: unknown[]) => {
        console.error('[Rule]', ...args)
      },
      warn: (...args: unknown[]) => {
        console.warn('[Rule]', ...args)
      },
      info: (...args: unknown[]) => {
        console.info('[Rule]', ...args)
      },
      debug: (...args: unknown[]) => {
        console.debug('[Rule]', ...args)
      },
    } as typeof console

    // Sandboxed require that provides limited modules
    const sandboxRequire = (module: string): unknown => {
      const allowedModules: Record<string, unknown> = {
        // Common modules used in Auth0 rules
        crypto: {
          createHash: (algorithm: string) => ({
            update: (data: string) => ({
              digest: (encoding: string) => {
                // Simple implementation for common use cases
                let hash = 0
                for (let i = 0; i < data.length; i++) {
                  const char = data.charCodeAt(i)
                  hash = ((hash << 5) - hash) + char
                  hash = hash & hash
                }
                return Math.abs(hash).toString(16)
              },
            }),
          }),
          randomBytes: (size: number) => {
            const bytes = new Uint8Array(size)
            crypto.getRandomValues(bytes)
            return {
              toString: (encoding: string) =>
                Array.from(bytes)
                  .map((b) => b.toString(16).padStart(2, '0'))
                  .join(''),
            }
          },
        },
        querystring: {
          stringify: (obj: Record<string, string>) =>
            new URLSearchParams(obj).toString(),
          parse: (str: string) =>
            Object.fromEntries(new URLSearchParams(str)),
        },
        url: {
          parse: (urlStr: string) => {
            const url = new URL(urlStr)
            return {
              protocol: url.protocol,
              hostname: url.hostname,
              pathname: url.pathname,
              query: Object.fromEntries(url.searchParams),
              href: url.href,
            }
          },
        },
      }

      if (module in allowedModules) {
        return allowedModules[module]
      }

      throw new Error(`Module '${module}' is not available in rules`)
    }

    // Sandboxed global object
    const sandboxGlobal: Record<string, unknown> = {
      configuration: this.configuration,
    }

    return {
      console: sandboxConsole,
      require: sandboxRequire,
      global: sandboxGlobal,
    }
  }

  /**
   * Extract function name from rule script
   */
  private extractFunctionName(script: string): string | null {
    // Match function declarations: function name(
    const funcMatch = script.match(/function\s+(\w+)\s*\(/)
    if (funcMatch) {
      return funcMatch[1]
    }

    // Match arrow functions assigned to const/let/var: const name =
    const arrowMatch = script.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/)
    if (arrowMatch) {
      return arrowMatch[1]
    }

    return null
  }

  /**
   * Generate a unique rule ID
   */
  private generateId(): string {
    const bytes = new Uint8Array(12)
    crypto.getRandomValues(bytes)
    return 'rul_' + Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  /**
   * Get the next order number for a new rule
   */
  private getNextOrder(): number {
    let maxOrder = 0
    for (const rule of this.rules.values()) {
      if (rule.order > maxOrder) {
        maxOrder = rule.order
      }
    }
    return maxOrder + 1
  }

  // ============================================================================
  // CONFIGURATION
  // ============================================================================

  /**
   * Set global configuration available to rules
   */
  setConfiguration(config: Record<string, string>): void {
    this.configuration = { ...config }
  }

  /**
   * Get global configuration
   */
  getConfiguration(): Record<string, string> {
    return { ...this.configuration }
  }

  /**
   * Set a single configuration value
   */
  setConfigurationValue(key: string, value: string): void {
    this.configuration[key] = value
  }

  /**
   * Delete a configuration value
   */
  deleteConfigurationValue(key: string): void {
    delete this.configuration[key]
  }
}

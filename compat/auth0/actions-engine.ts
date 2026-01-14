/**
 * @dotdo/auth0 - Actions Engine
 *
 * Auth0 Actions execution engine for modern Actions support.
 * Actions are modern, trigger-based custom code that runs during authentication flows.
 *
 * @example Basic Usage
 * ```typescript
 * import { ActionsEngine } from '@dotdo/auth0'
 *
 * const engine = new ActionsEngine()
 *
 * // Create an action
 * const action = engine.create({
 *   name: 'Add roles to token',
 *   code: `
 *     exports.onExecutePostLogin = async (event, api) => {
 *       const roles = event.user.app_metadata?.roles || [];
 *       api.accessToken.setCustomClaim('https://example.com/roles', roles);
 *     }
 *   `,
 *   supported_triggers: [{ id: 'post-login' }],
 * })
 *
 * // Execute actions for post-login trigger
 * const result = await engine.executePostLogin(event, api)
 * ```
 *
 * @see https://auth0.com/docs/customize/actions
 * @module
 */

import type {
  Action,
  CreateActionParams,
  UpdateActionParams,
  ActionTrigger,
  ActionStatus,
  ActionRuntime,
  ActionExecutionResult,
  ActionCommand,
  PostLoginEvent,
  PostLoginApi,
  PreUserRegistrationEvent,
  PreUserRegistrationApi,
  PostUserRegistrationEvent,
  PostUserRegistrationApi,
  PostChangePasswordEvent,
  PostChangePasswordApi,
} from './types'
import { Auth0ManagementError } from './types'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Options for ActionsEngine
 */
export interface ActionsEngineOptions {
  /** Execution timeout in milliseconds (default: 20000) */
  timeout?: number
  /** Default runtime version */
  runtime?: ActionRuntime
}

/**
 * Binding for a trigger (ordered list of actions)
 */
export interface TriggerBinding {
  trigger_id: ActionTrigger
  action_ids: string[]
}

/**
 * Flow execution result
 */
export interface FlowExecutionResult {
  /** Whether all actions executed successfully */
  success: boolean
  /** Individual action results */
  results: ActionExecutionResult[]
  /** All commands from all actions */
  commands: ActionCommand[]
  /** All logs from all actions */
  logs: string[]
  /** Total execution time in ms */
  totalExecutionTimeMs: number
  /** Error if flow failed */
  error?: string
  /** Whether access was denied */
  denied?: boolean
  /** Denial reason if denied */
  denialReason?: string
  /** Redirect URL if redirect was requested */
  redirectUrl?: string
}

// ============================================================================
// API BUILDER
// ============================================================================

/**
 * Create a PostLoginApi object that captures commands
 */
function createPostLoginApi(commands: ActionCommand[], logs: string[]): PostLoginApi {
  return {
    accessToken: {
      setCustomClaim: (name: string, value: unknown) => {
        commands.push({ type: 'setCustomClaim', target: 'accessToken', name, value })
      },
      addScope: (scope: string) => {
        commands.push({ type: 'addScope', scope })
      },
      removeScope: (scope: string) => {
        commands.push({ type: 'removeScope', scope })
      },
    },
    idToken: {
      setCustomClaim: (name: string, value: unknown) => {
        commands.push({ type: 'setCustomClaim', target: 'idToken', name, value })
      },
    },
    user: {
      setAppMetadata: (key: string, value: unknown) => {
        commands.push({ type: 'setAppMetadata', key, value })
      },
      setUserMetadata: (key: string, value: unknown) => {
        commands.push({ type: 'setUserMetadata', key, value })
      },
    },
    multifactor: {
      enable: (provider: string, options?: { allowRememberBrowser?: boolean }) => {
        commands.push({ type: 'enableMfa', provider, options })
      },
    },
    session: {
      set: (key: string, value: unknown) => {
        commands.push({ type: 'setSession', key, value })
      },
    },
    authentication: {
      challengeWith: (factor: { type: string; options?: Record<string, unknown> }) => {
        commands.push({ type: 'challengeWith', factor })
      },
      challengeWithAny: (factors: Array<{ type: string; options?: Record<string, unknown> }>) => {
        for (const factor of factors) {
          commands.push({ type: 'challengeWith', factor })
        }
      },
      setPrimaryUser: (_userId: string) => {
        // Account linking - not implemented in this compat layer
      },
      recordMethod: (_method: string) => {
        // Record auth method - not implemented in this compat layer
      },
      enrollWith: (_factor: { type: string; options?: Record<string, unknown> }) => {
        // MFA enrollment - not implemented in this compat layer
      },
    },
    redirect: {
      sendUserTo: (url: string, options?: { query?: Record<string, string> }) => {
        commands.push({ type: 'redirect', url, query: options?.query })
      },
      validateToken: (_options: { secret: string; tokenParameterName?: string }) => {
        // Token validation after redirect - would need request context
        return {}
      },
    },
    access: {
      deny: (reason: string) => {
        commands.push({ type: 'deny', reason })
      },
    },
  }
}

/**
 * Create a PreUserRegistrationApi object that captures commands
 */
function createPreUserRegistrationApi(commands: ActionCommand[], _logs: string[]): PreUserRegistrationApi {
  let validationError: { code: string; message: string } | null = null

  return {
    user: {
      setAppMetadata: (key: string, value: unknown) => {
        commands.push({ type: 'setAppMetadata', key, value })
      },
      setUserMetadata: (key: string, value: unknown) => {
        commands.push({ type: 'setUserMetadata', key, value })
      },
    },
    access: {
      deny: (code: string, reason: string) => {
        commands.push({ type: 'deny', reason: `${code}: ${reason}` })
      },
    },
    validation: {
      error: (code: string, message: string) => {
        validationError = { code, message }
        commands.push({ type: 'deny', reason: `Validation error: ${code} - ${message}` })
      },
    },
  }
}

/**
 * Create a PostUserRegistrationApi object that captures commands
 */
function createPostUserRegistrationApi(commands: ActionCommand[], _logs: string[]): PostUserRegistrationApi {
  return {
    user: {
      setAppMetadata: (key: string, value: unknown) => {
        commands.push({ type: 'setAppMetadata', key, value })
      },
      setUserMetadata: (key: string, value: unknown) => {
        commands.push({ type: 'setUserMetadata', key, value })
      },
    },
  }
}

/**
 * Create a PostChangePasswordApi object that captures commands
 */
function createPostChangePasswordApi(commands: ActionCommand[], _logs: string[]): PostChangePasswordApi {
  return {
    user: {
      setAppMetadata: (key: string, value: unknown) => {
        commands.push({ type: 'setAppMetadata', key, value })
      },
      setUserMetadata: (key: string, value: unknown) => {
        commands.push({ type: 'setUserMetadata', key, value })
      },
    },
  }
}

// ============================================================================
// ACTIONS ENGINE
// ============================================================================

/**
 * Auth0 Actions Engine
 *
 * Executes Auth0 Actions during authentication flows.
 * Actions are executed in the order specified by trigger bindings.
 */
export class ActionsEngine {
  private actions = new Map<string, Action>()
  private bindings = new Map<ActionTrigger, string[]>()
  private secrets = new Map<string, Map<string, string>>() // actionId -> secrets
  private timeout: number
  private defaultRuntime: ActionRuntime

  constructor(options: ActionsEngineOptions = {}) {
    this.timeout = options.timeout ?? 20000
    this.defaultRuntime = options.runtime ?? 'node18'
  }

  // ============================================================================
  // CRUD OPERATIONS
  // ============================================================================

  /**
   * Create a new action
   */
  create(params: CreateActionParams): Action {
    if (!params.name) {
      throw new Auth0ManagementError('Action name is required', 400, 'invalid_body')
    }
    if (!params.code) {
      throw new Auth0ManagementError('Action code is required', 400, 'invalid_body')
    }
    if (!params.supported_triggers || params.supported_triggers.length === 0) {
      throw new Auth0ManagementError('At least one trigger is required', 400, 'invalid_body')
    }

    // Check for duplicate name
    for (const action of this.actions.values()) {
      if (action.name === params.name) {
        throw new Auth0ManagementError(
          'An action with this name already exists',
          409,
          'action_conflict'
        )
      }
    }

    const now = new Date().toISOString()
    const id = this.generateId()

    const action: Action = {
      id,
      name: params.name,
      code: params.code,
      supported_triggers: params.supported_triggers.map((t) => ({
        id: t.id,
        version: t.version ?? 'v2',
      })),
      dependencies: params.dependencies ?? [],
      secrets: (params.secrets ?? []).map((s) => ({
        name: s.name,
        updated_at: now,
      })),
      runtime: params.runtime ?? this.defaultRuntime,
      status: 'pending' as ActionStatus,
      created_at: now,
      updated_at: now,
    }

    this.actions.set(id, action)

    // Store secrets separately (they're write-only)
    if (params.secrets && params.secrets.length > 0) {
      const actionSecrets = new Map<string, string>()
      for (const secret of params.secrets) {
        actionSecrets.set(secret.name, secret.value)
      }
      this.secrets.set(id, actionSecrets)
    }

    return action
  }

  /**
   * Get an action by ID
   */
  get(id: string): Action | null {
    return this.actions.get(id) ?? null
  }

  /**
   * Get all actions
   */
  getAll(params?: { trigger?: ActionTrigger; status?: ActionStatus }): Action[] {
    let actions = Array.from(this.actions.values())

    if (params?.trigger) {
      actions = actions.filter((a) =>
        a.supported_triggers.some((t) => t.id === params.trigger)
      )
    }

    if (params?.status) {
      actions = actions.filter((a) => a.status === params.status)
    }

    return actions.sort((a, b) => a.name.localeCompare(b.name))
  }

  /**
   * Update an action
   */
  update(id: string, params: UpdateActionParams): Action {
    const action = this.actions.get(id)
    if (!action) {
      throw new Auth0ManagementError('Action not found', 404, 'inexistent_action')
    }

    // Check for duplicate name if name is being changed
    if (params.name && params.name !== action.name) {
      for (const a of this.actions.values()) {
        if (a.name === params.name && a.id !== id) {
          throw new Auth0ManagementError(
            'An action with this name already exists',
            409,
            'action_conflict'
          )
        }
      }
    }

    const now = new Date().toISOString()

    const updatedAction: Action = {
      ...action,
      name: params.name ?? action.name,
      code: params.code ?? action.code,
      dependencies: params.dependencies ?? action.dependencies,
      runtime: params.runtime ?? action.runtime,
      status: params.code ? 'pending' : action.status, // Reset to pending if code changes
      updated_at: now,
    }

    // Update secrets if provided
    if (params.secrets) {
      updatedAction.secrets = params.secrets.map((s) => ({
        name: s.name,
        updated_at: now,
      }))

      const actionSecrets = this.secrets.get(id) ?? new Map<string, string>()
      for (const secret of params.secrets) {
        actionSecrets.set(secret.name, secret.value)
      }
      this.secrets.set(id, actionSecrets)
    }

    this.actions.set(id, updatedAction)
    return updatedAction
  }

  /**
   * Delete an action
   */
  delete(id: string): void {
    // Remove from all bindings
    for (const [trigger, actionIds] of this.bindings.entries()) {
      const index = actionIds.indexOf(id)
      if (index !== -1) {
        actionIds.splice(index, 1)
      }
    }

    this.actions.delete(id)
    this.secrets.delete(id)
  }

  /**
   * Deploy an action (mark as deployed)
   */
  deploy(id: string): Action {
    const action = this.actions.get(id)
    if (!action) {
      throw new Auth0ManagementError('Action not found', 404, 'inexistent_action')
    }

    const now = new Date().toISOString()
    const versionNumber = (action.deployed_version?.number ?? 0) + 1

    const updatedAction: Action = {
      ...action,
      status: 'deployed',
      deployed_version: {
        id: `ver_${this.generateId().slice(4)}`,
        deployed: true,
        number: versionNumber,
        created_at: now,
      },
      updated_at: now,
    }

    this.actions.set(id, updatedAction)
    return updatedAction
  }

  // ============================================================================
  // TRIGGER BINDINGS
  // ============================================================================

  /**
   * Get bindings for a trigger
   */
  getBindings(trigger: ActionTrigger): string[] {
    return [...(this.bindings.get(trigger) ?? [])]
  }

  /**
   * Set bindings for a trigger
   */
  setBindings(trigger: ActionTrigger, actionIds: string[]): void {
    // Validate all action IDs exist
    for (const id of actionIds) {
      const action = this.actions.get(id)
      if (!action) {
        throw new Auth0ManagementError(
          `Action ${id} not found`,
          404,
          'inexistent_action'
        )
      }
      // Validate action supports this trigger
      if (!action.supported_triggers.some((t) => t.id === trigger)) {
        throw new Auth0ManagementError(
          `Action ${action.name} does not support trigger ${trigger}`,
          400,
          'invalid_binding'
        )
      }
    }

    this.bindings.set(trigger, [...actionIds])
  }

  /**
   * Add an action to a trigger's bindings
   */
  addBinding(trigger: ActionTrigger, actionId: string, position?: number): void {
    const action = this.actions.get(actionId)
    if (!action) {
      throw new Auth0ManagementError('Action not found', 404, 'inexistent_action')
    }
    if (!action.supported_triggers.some((t) => t.id === trigger)) {
      throw new Auth0ManagementError(
        `Action ${action.name} does not support trigger ${trigger}`,
        400,
        'invalid_binding'
      )
    }

    const bindings = this.bindings.get(trigger) ?? []

    // Remove if already exists
    const existingIndex = bindings.indexOf(actionId)
    if (existingIndex !== -1) {
      bindings.splice(existingIndex, 1)
    }

    // Add at position or end
    if (position !== undefined && position >= 0 && position <= bindings.length) {
      bindings.splice(position, 0, actionId)
    } else {
      bindings.push(actionId)
    }

    this.bindings.set(trigger, bindings)
  }

  /**
   * Remove an action from a trigger's bindings
   */
  removeBinding(trigger: ActionTrigger, actionId: string): void {
    const bindings = this.bindings.get(trigger)
    if (!bindings) return

    const index = bindings.indexOf(actionId)
    if (index !== -1) {
      bindings.splice(index, 1)
    }
  }

  // ============================================================================
  // EXECUTION
  // ============================================================================

  /**
   * Execute post-login flow
   */
  async executePostLogin(event: PostLoginEvent): Promise<FlowExecutionResult> {
    return this.executeFlow('post-login', event, createPostLoginApi)
  }

  /**
   * Execute pre-user-registration flow
   */
  async executePreUserRegistration(
    event: PreUserRegistrationEvent
  ): Promise<FlowExecutionResult> {
    return this.executeFlow('pre-user-registration', event, createPreUserRegistrationApi)
  }

  /**
   * Execute post-user-registration flow
   */
  async executePostUserRegistration(
    event: PostUserRegistrationEvent
  ): Promise<FlowExecutionResult> {
    return this.executeFlow('post-user-registration', event, createPostUserRegistrationApi)
  }

  /**
   * Execute post-change-password flow
   */
  async executePostChangePassword(
    event: PostChangePasswordEvent
  ): Promise<FlowExecutionResult> {
    return this.executeFlow('post-change-password', event, createPostChangePasswordApi)
  }

  /**
   * Execute a flow for a trigger
   */
  private async executeFlow<TEvent, TApi>(
    trigger: ActionTrigger,
    event: TEvent,
    createApi: (commands: ActionCommand[], logs: string[]) => TApi
  ): Promise<FlowExecutionResult> {
    const startTime = Date.now()
    const results: ActionExecutionResult[] = []
    const allCommands: ActionCommand[] = []
    const allLogs: string[] = []

    // Get bound actions for this trigger
    const actionIds = this.bindings.get(trigger) ?? []

    let flowError: string | undefined
    let denied = false
    let denialReason: string | undefined
    let redirectUrl: string | undefined

    for (const actionId of actionIds) {
      const action = this.actions.get(actionId)
      if (!action || action.status !== 'deployed') {
        continue
      }

      const actionCommands: ActionCommand[] = []
      const actionLogs: string[] = []
      const api = createApi(actionCommands, actionLogs)

      const result = await this.executeAction(action, event, api, actionCommands, actionLogs)
      results.push(result)

      if (!result.success) {
        flowError = result.error
        break
      }

      // Process commands
      for (const cmd of actionCommands) {
        allCommands.push(cmd)

        if (cmd.type === 'deny') {
          denied = true
          denialReason = cmd.reason
          break
        }

        if (cmd.type === 'redirect') {
          redirectUrl = cmd.url
          if (cmd.query) {
            const params = new URLSearchParams(cmd.query)
            redirectUrl += `?${params.toString()}`
          }
        }
      }

      allLogs.push(...actionLogs)

      // Stop flow if denied
      if (denied) {
        break
      }
    }

    return {
      success: !flowError && !denied,
      results,
      commands: allCommands,
      logs: allLogs,
      totalExecutionTimeMs: Date.now() - startTime,
      error: flowError,
      denied,
      denialReason,
      redirectUrl,
    }
  }

  /**
   * Execute a single action
   */
  private async executeAction<TEvent, TApi>(
    action: Action,
    event: TEvent,
    api: TApi,
    commands: ActionCommand[],
    logs: string[]
  ): Promise<ActionExecutionResult> {
    const startTime = Date.now()

    try {
      // Get action secrets
      const secrets = this.secrets.get(action.id) ?? new Map<string, string>()
      const secretsObj: Record<string, string> = {}
      for (const [key, value] of secrets) {
        secretsObj[key] = value
      }

      // Execute action code
      await this.runAction(action.code, event, api, secretsObj, logs)

      return {
        success: true,
        executionTimeMs: Date.now() - startTime,
        actionId: action.id,
        actionName: action.name,
        commands: [...commands],
        logs: [...logs],
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTimeMs: Date.now() - startTime,
        actionId: action.id,
        actionName: action.name,
        commands: [...commands],
        logs: [...logs],
      }
    }
  }

  /**
   * Run action code in sandboxed environment
   */
  private async runAction<TEvent, TApi>(
    code: string,
    event: TEvent,
    api: TApi,
    secrets: Record<string, string>,
    logs: string[]
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeoutId = setTimeout(() => {
        reject(new Error('Action execution timeout'))
      }, this.timeout)

      try {
        // Determine the handler name based on exports
        const handlerName = this.getHandlerName(code)
        if (!handlerName) {
          throw new Error('No valid handler found in action code')
        }

        // Create sandboxed console
        const sandboxConsole = {
          log: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
          error: (...args: unknown[]) => logs.push(`ERROR: ${args.map(String).join(' ')}`),
          warn: (...args: unknown[]) => logs.push(`WARN: ${args.map(String).join(' ')}`),
          info: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
          debug: (...args: unknown[]) => logs.push(`DEBUG: ${args.map(String).join(' ')}`),
        }

        // Create require stub
        const requireStub = (module: string): unknown => {
          // Support common modules used in actions
          if (module === 'axios' || module === 'node-fetch') {
            return async (url: string, options?: RequestInit) => {
              const response = await fetch(url, options)
              return {
                data: await response.json(),
                status: response.status,
                headers: Object.fromEntries(response.headers),
              }
            }
          }
          throw new Error(`Module '${module}' is not available in actions`)
        }

        // Create exports object
        const exports: Record<string, unknown> = {}

        // Wrap and execute the code
        const wrappedCode = `
          (function(exports, require, console, event, api) {
            ${code}
          })
        `

        const fn = eval(wrappedCode) as (
          exports: Record<string, unknown>,
          require: (m: string) => unknown,
          console: typeof sandboxConsole,
          event: TEvent,
          api: TApi
        ) => void

        fn(exports, requireStub, sandboxConsole, event, api)

        // Get the handler
        const handler = exports[handlerName] as (
          event: TEvent,
          api: TApi
        ) => Promise<void>

        if (typeof handler !== 'function') {
          throw new Error(`Handler '${handlerName}' is not a function`)
        }

        // Execute the handler
        Promise.resolve(handler(event, api))
          .then(() => {
            clearTimeout(timeoutId)
            resolve()
          })
          .catch((error) => {
            clearTimeout(timeoutId)
            reject(error)
          })
      } catch (error) {
        clearTimeout(timeoutId)
        reject(error)
      }
    })
  }

  /**
   * Get the handler name from action code
   */
  private getHandlerName(code: string): string | null {
    // Check for different trigger handlers
    const handlers = [
      'onExecutePostLogin',
      'onExecutePreUserRegistration',
      'onExecutePostUserRegistration',
      'onExecutePostChangePassword',
      'onExecuteSendPhoneMessage',
      'onExecuteCredentialsExchange',
      'onExecutePasswordResetPostChallenge',
    ]

    for (const handler of handlers) {
      if (code.includes(handler)) {
        return handler
      }
    }

    return null
  }

  /**
   * Generate a unique action ID
   */
  private generateId(): string {
    const bytes = new Uint8Array(12)
    crypto.getRandomValues(bytes)
    return 'act_' + Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  // ============================================================================
  // SECRETS MANAGEMENT
  // ============================================================================

  /**
   * Set a secret for an action
   */
  setSecret(actionId: string, name: string, value: string): void {
    const action = this.actions.get(actionId)
    if (!action) {
      throw new Auth0ManagementError('Action not found', 404, 'inexistent_action')
    }

    const actionSecrets = this.secrets.get(actionId) ?? new Map<string, string>()
    actionSecrets.set(name, value)
    this.secrets.set(actionId, actionSecrets)

    // Update action's secrets list
    const now = new Date().toISOString()
    if (!action.secrets.some((s) => s.name === name)) {
      action.secrets.push({ name, updated_at: now })
    } else {
      const secret = action.secrets.find((s) => s.name === name)
      if (secret) {
        secret.updated_at = now
      }
    }
    action.updated_at = now
    this.actions.set(actionId, action)
  }

  /**
   * Delete a secret from an action
   */
  deleteSecret(actionId: string, name: string): void {
    const action = this.actions.get(actionId)
    if (!action) {
      throw new Auth0ManagementError('Action not found', 404, 'inexistent_action')
    }

    const actionSecrets = this.secrets.get(actionId)
    if (actionSecrets) {
      actionSecrets.delete(name)
    }

    // Update action's secrets list
    const now = new Date().toISOString()
    action.secrets = action.secrets.filter((s) => s.name !== name)
    action.updated_at = now
    this.actions.set(actionId, action)
  }
}

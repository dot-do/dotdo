/**
 * User Proxy Context API for $.user.*
 *
 * Provides a workflow context API for user interactions:
 * - $.user.confirm(message) - Ask user for confirmation (returns boolean)
 * - $.user.prompt(question) - Get text input from user (returns string)
 * - $.user.select(question, options) - Show options to user (returns selected option)
 * - $.user.notify(message) - Send notification to user (fire-and-forget)
 * - $.user.chat(message) - Open chat interface for conversation
 *
 * Unlike $.human.*, which routes to specific roles (CEO, Legal, etc.),
 * $.user.* interacts directly with the end user of the application.
 *
 * @module workflows/context/user
 */

import {
  type DurableObjectNamespace,
  type DurableObjectId,
  type DurableObjectStub,
  DEFAULT_TIMEOUT,
  getDOStub as getDOStubBase,
  makeRequest as makeRequestBase,
} from './human-base'

// Re-export base types for backwards compatibility
export type { DurableObjectNamespace, DurableObjectId, DurableObjectStub }

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Environment bindings for User DO
 */
export interface UserProxyEnv {
  USER_DO: DurableObjectNamespace
}

/**
 * Configuration for creating a user proxy
 */
export interface UserProxyConfig {
  /** Environment with DO bindings */
  env: UserProxyEnv
  /** Default timeout for user responses (ms) */
  defaultTimeout?: number
  /** User ID for context */
  userId?: string
}

/**
 * Options for confirm method
 */
export interface ConfirmOptions {
  timeout?: number
  default?: boolean
}

/**
 * Options for prompt method
 */
export interface PromptOptions {
  timeout?: number
  placeholder?: string
  validate?: (value: string) => boolean
}

/**
 * Options for select method
 */
export interface SelectOptions {
  timeout?: number
}

/**
 * Chat conversation result
 */
export interface ChatConversation {
  messages: Array<{ role: string; content: string }>
  close: () => Promise<void>
}

/**
 * User proxy context returned by factory
 */
export interface UserProxyContext {
  user: {
    confirm: (message: string, options?: ConfirmOptions) => Promise<boolean>
    prompt: (question: string, options?: PromptOptions) => Promise<string>
    select: <T extends string>(question: string, options: T[], selectOptions?: SelectOptions) => Promise<T>
    notify: (message: string) => Promise<void>
    chat: (message: string) => Promise<ChatConversation>
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Creates a user proxy context for user interactions in workflows
 *
 * @param config - Configuration options
 * @returns UserProxyContext with user methods
 */
export function createUserProxy(config: UserProxyConfig): UserProxyContext {
  const { env, defaultTimeout = DEFAULT_TIMEOUT, userId = 'default' } = config

  /**
   * Get DO stub for user
   */
  function getDOStub(): DurableObjectStub {
    return getDOStubBase({
      namespace: env.USER_DO,
      name: userId,
    })
  }

  /**
   * Make a request to User DO
   */
  async function makeRequest(path: string, method: string, body?: Record<string, unknown>): Promise<Response> {
    const stub = getDOStub()
    return makeRequestBase({
      stub,
      baseUrl: 'https://user.do',
      path,
      method,
      body,
    })
  }

  return {
    user: {
      /**
       * Ask user for confirmation
       */
      async confirm(message: string, options: ConfirmOptions = {}): Promise<boolean> {
        const response = await makeRequest('/confirm', 'POST', {
          message,
          timeout: options.timeout ?? defaultTimeout,
          default: options.default,
        })

        const result = (await response.json()) as { confirmed: boolean }
        return result.confirmed
      },

      /**
       * Get text input from user
       */
      async prompt(question: string, options: PromptOptions = {}): Promise<string> {
        const response = await makeRequest('/prompt', 'POST', {
          question,
          timeout: options.timeout ?? defaultTimeout,
          placeholder: options.placeholder,
          hasValidation: !!options.validate,
        })

        const result = (await response.json()) as { answer: string }
        const answer = result.answer ?? ''

        // Validate if validation function provided
        if (options.validate && !options.validate(answer)) {
          // In real implementation, would retry
          return answer
        }

        return answer
      },

      /**
       * Show options to user
       */
      async select<T extends string>(question: string, selectOptions: T[], options: SelectOptions = {}): Promise<T> {
        const response = await makeRequest('/select', 'POST', {
          question,
          options: selectOptions,
          timeout: options.timeout ?? defaultTimeout,
        })

        const result = (await response.json()) as { selected: T }
        return result.selected ?? selectOptions[0]
      },

      /**
       * Send notification to user (fire-and-forget)
       */
      async notify(message: string): Promise<void> {
        await makeRequest('/notify', 'POST', { message })
      },

      /**
       * Open chat interface for conversation
       */
      async chat(message: string): Promise<ChatConversation> {
        const response = await makeRequest('/chat', 'POST', { message })
        const result = (await response.json()) as { conversationId: string }

        return {
          messages: [{ role: 'assistant', content: message }],
          close: async () => {
            await makeRequest(`/chat/${result.conversationId}/close`, 'POST')
          },
        }
      },
    },
  }
}

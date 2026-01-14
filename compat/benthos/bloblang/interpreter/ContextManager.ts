/**
 * ContextManager - Handles variable scope and context management in Bloblang
 * Issue: dotdo-h5ix3 - Interpreter Decomposition
 *
 * Manages variable scopes, special references (root, this, meta),
 * and pipe value context for the Bloblang interpreter.
 */

import { BenthosMessage, createMessage } from '../../core/message'

/**
 * Options for creating scopes
 */
export interface ScopeOptions {
  /** Initial variables to populate the scope with */
  initialVariables?: Map<string, unknown>
  /** Value being piped through (accessible via _) */
  pipeValue?: unknown
  /** Custom 'this' value for the scope */
  thisValue?: unknown
}

/**
 * Interpreter context holding message and variable bindings
 */
export interface InterpreterContext {
  message: BenthosMessage
  variables: Map<string, unknown>
  pipeValue?: unknown
  /** Reference to parent context for scope chain lookup */
  parent?: InterpreterContext
  /** Custom 'this' value (if set, overrides message.root) */
  thisValue?: unknown
}

/**
 * ContextManager handles variable scope management for the Bloblang interpreter.
 *
 * Responsibilities:
 * - Creating and managing interpreter contexts
 * - Variable scope creation and lookup with parent chain
 * - Support for variable shadowing
 * - Managing special references: root, this, meta
 * - Pipe value context (_) management
 */
export class ContextManager {
  /**
   * Create a new interpreter context
   */
  createContext(message?: BenthosMessage, options?: ScopeOptions): InterpreterContext {
    const ctx: InterpreterContext = {
      message: message ?? createMessage({}),
      variables: new Map(options?.initialVariables),
      pipeValue: options?.pipeValue,
      thisValue: options?.thisValue,
    }
    return ctx
  }

  /**
   * Create a child context with parent scope access
   */
  createChildContext(parent: InterpreterContext, options?: ScopeOptions): InterpreterContext {
    const ctx: InterpreterContext = {
      message: parent.message,
      variables: new Map(), // Start with empty variables, lookup chain goes to parent
      pipeValue: options?.pipeValue !== undefined ? options.pipeValue : parent.pipeValue,
      parent,
      thisValue: options?.thisValue !== undefined ? options.thisValue : parent.thisValue,
    }

    // Copy initial variables if provided
    if (options?.initialVariables) {
      for (const [key, value] of options.initialVariables) {
        ctx.variables.set(key, value)
      }
    }

    return ctx
  }

  /**
   * Get a variable value, checking scope chain and message root
   */
  getVariable(ctx: InterpreterContext, name: string): unknown {
    // Handle empty name
    if (!name) return undefined

    // Handle _ placeholder for pipe value
    if (name === '_') {
      return ctx.pipeValue
    }

    // Normalize variable name (handle $ prefix)
    const normalizedName = name.startsWith('$') ? name.slice(1) : name

    // Check current scope first
    if (ctx.variables.has(normalizedName)) {
      return ctx.variables.get(normalizedName)
    }
    // Also check with $ prefix for explicit $ vars
    if (ctx.variables.has(name)) {
      return ctx.variables.get(name)
    }

    // Check parent scope chain
    if (ctx.parent) {
      const parentValue = this.getVariable(ctx.parent, normalizedName)
      if (parentValue !== undefined) {
        return parentValue
      }
    }

    // Fall back to message root properties
    const root = this.getRoot(ctx)
    if (root && typeof root === 'object' && root !== null && !Array.isArray(root)) {
      if (normalizedName in (root as Record<string, unknown>)) {
        return (root as Record<string, unknown>)[normalizedName]
      }
    }

    return undefined
  }

  /**
   * Set a variable in the current scope
   */
  setVariable(ctx: InterpreterContext, name: string, value: unknown): void {
    // Normalize variable name (remove $ prefix for storage)
    const normalizedName = name.startsWith('$') ? name.slice(1) : name
    ctx.variables.set(normalizedName, value)
  }

  /**
   * Check if a variable exists in the scope chain or message root
   */
  hasVariable(ctx: InterpreterContext, name: string): boolean {
    // Handle _ placeholder
    if (name === '_') {
      return ctx.pipeValue !== undefined
    }

    // Normalize variable name
    const normalizedName = name.startsWith('$') ? name.slice(1) : name

    // Check current scope
    if (ctx.variables.has(normalizedName) || ctx.variables.has(name)) {
      return true
    }

    // Check parent scope chain
    if (ctx.parent) {
      if (this.hasVariable(ctx.parent, normalizedName)) {
        return true
      }
    }

    // Check message root properties
    const root = this.getRoot(ctx)
    if (root && typeof root === 'object' && root !== null && !Array.isArray(root)) {
      return normalizedName in (root as Record<string, unknown>)
    }

    return false
  }

  /**
   * Delete a variable from the current scope
   */
  deleteVariable(ctx: InterpreterContext, name: string): void {
    const normalizedName = name.startsWith('$') ? name.slice(1) : name
    ctx.variables.delete(normalizedName)
    ctx.variables.delete(name)
  }

  /**
   * Get the root value from the message
   */
  getRoot(ctx: InterpreterContext): unknown {
    // Use jsonSafe to handle non-JSON content gracefully
    const result = ctx.message.jsonSafe()
    if (result === undefined) {
      // If content isn't valid JSON, return the raw content
      return ctx.message.content
    }
    return result
  }

  /**
   * Get the 'this' value for the context
   */
  getThis(ctx: InterpreterContext): unknown {
    // If a custom thisValue is set, use it
    if (ctx.thisValue !== undefined) {
      return ctx.thisValue
    }

    // Otherwise, return the message root
    return this.getRoot(ctx)
  }

  /**
   * Get metadata from the message
   */
  getMeta(ctx: InterpreterContext, key?: string): unknown {
    if (key !== undefined) {
      return ctx.message.metadata.get(key)
    }
    return ctx.message.metadata.toObject()
  }

  /**
   * Get the current pipe value
   */
  getPipeValue(ctx: InterpreterContext): unknown {
    return ctx.pipeValue
  }

  /**
   * Set the pipe value in a context
   */
  setPipeValue(ctx: InterpreterContext, value: unknown): void {
    ctx.pipeValue = value
  }
}

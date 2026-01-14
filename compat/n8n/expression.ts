/**
 * n8n Expression Parser
 *
 * Evaluates n8n-style expressions like {{ $json.field }}, {{ $node['name'].json }}, etc.
 */

import type { IExpressionContext } from './types'

/**
 * Expression parser for n8n-style template expressions.
 *
 * Supports:
 * - $json - Current item JSON data
 * - $item - Current item info (index)
 * - $node['name'] - Access previous node outputs
 * - $input - Input data helpers (first, last, all)
 * - $env - Environment variables
 * - $now - Current datetime
 * - $today - Start of today
 * - JavaScript expressions
 */
export class ExpressionParser {
  /**
   * Evaluate an expression string against a context.
   *
   * @param expression - Expression string, e.g. "{{ $json.name }}" or "Hello, {{ $json.name }}!"
   * @param context - Context object with $json, $item, $node, etc.
   * @returns Evaluated result
   */
  evaluate(expression: string, context: IExpressionContext): unknown {
    // Check if it's a pure expression (just {{ ... }}) or mixed with text
    const pureExpressionMatch = expression.match(/^\{\{\s*(.*?)\s*\}\}$/)

    if (pureExpressionMatch) {
      // Pure expression - return the actual value (number, object, etc.)
      return this.evaluateExpression(pureExpressionMatch[1], context)
    }

    // Mixed expression - interpolate and return string
    return expression.replace(/\{\{\s*(.*?)\s*\}\}/g, (_, expr) => {
      const result = this.evaluateExpression(expr, context)
      return String(result)
    })
  }

  /**
   * Evaluate a single expression (without {{ }})
   */
  private evaluateExpression(expr: string, context: IExpressionContext): unknown {
    // Build the evaluation context with all n8n variables
    const evalContext = this.buildEvalContext(context)

    // Create a safe evaluation function
    try {
      // Handle special cases
      if (expr === '$now') {
        return new Date()
      }
      if (expr === '$today') {
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        return today
      }

      // Build the function with all context variables
      const contextKeys = Object.keys(evalContext)
      const contextValues = Object.values(evalContext)

      // Create function that has access to all context variables
      // eslint-disable-next-line no-new-func
      const fn = new Function(...contextKeys, `return ${expr}`)

      return fn(...contextValues)
    } catch (error) {
      // Return undefined for invalid expressions
      return undefined
    }
  }

  /**
   * Build the evaluation context with all n8n variables
   */
  private buildEvalContext(context: IExpressionContext): Record<string, unknown> {
    const evalContext: Record<string, unknown> = {}

    // $json - current item JSON
    if (context.$json !== undefined) {
      evalContext.$json = context.$json
    }

    // $item - current item info
    if (context.$item !== undefined) {
      evalContext.$item = context.$item
    }

    // $node - previous node outputs
    if (context.$node !== undefined) {
      evalContext.$node = context.$node
    }

    // $input - input data helpers
    if (context.$input !== undefined) {
      evalContext.$input = context.$input
    }

    // $env - environment variables
    if (context.$env !== undefined) {
      evalContext.$env = context.$env
    }

    // $execution - execution context
    if (context.$execution !== undefined) {
      evalContext.$execution = context.$execution
    }

    // $workflow - workflow info
    if (context.$workflow !== undefined) {
      evalContext.$workflow = context.$workflow
    }

    // $now - current datetime
    evalContext.$now = new Date()

    // $today - start of today
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    evalContext.$today = today

    return evalContext
  }

  /**
   * Check if a string contains expression syntax
   */
  containsExpression(value: string): boolean {
    return /\{\{.*?\}\}/.test(value)
  }

  /**
   * Resolve all expressions in an object recursively
   */
  resolveExpressions(obj: unknown, context: IExpressionContext): unknown {
    if (typeof obj === 'string') {
      if (this.containsExpression(obj)) {
        return this.evaluate(obj, context)
      }
      return obj
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.resolveExpressions(item, context))
    }

    if (obj !== null && typeof obj === 'object') {
      const result: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.resolveExpressions(value, context)
      }
      return result
    }

    return obj
  }
}
